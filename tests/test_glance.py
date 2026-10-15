"""Contract tests for the board at a glance (0.3.1): what changed since a screen last looked, rows grouped by project,
age in state and relative time.

    python3 -m unittest discover -s tests

Added under the same deliberate, narrow exception as tests/test_contract.py and tests/test_gaps.py, which the owner
extended to this release (CONTRIBUTING.md, "Tests"). They cover only pure core logic and the view contract:
  - since you last looked: the opaque marks and the delta (src/weatherdeck/glance.py);
  - grouping by project first and machine second, in an order that never moves with the data (src/weatherdeck/glance.py);
  - age in state and relative time in plain words (src/weatherdeck/gaps.py, src/weatherdeck/glance.py).
Synthetic data only, standard library only, no network, no clock: every time is passed in.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import gaps, glance  # noqa: E402

NOW = 1_800_000_000          # 2027-01-15T08:00:00Z, a fixed clock


def iso(t):
    import time
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def lane(id_, cls, kind, chip=None, machine=None, source="home-a", **kw):
    it = {"id": id_, "source": source, "owner": source, "machine": machine, "lane": {"cls": cls, "kind": kind},
          "row": {"chip": chip, "title": id_}}
    it.update(kw)
    return it


class Marks(unittest.TestCase):
    def test_keys_are_opaque_stable_and_distinct(self):
        k = glance.key("lane", "home-a", "fix-login")
        self.assertRegex(k, r"^[0-9a-f]{12}$")
        self.assertEqual(k, glance.key("lane", "home-a", "fix-login"))           # no salt: survives a host restart
        self.assertNotEqual(k, glance.key("lane", "home-b", "fix-login"))        # the source is part of it
        self.assertNotIn("fix-login", k)

    def test_marks_hold_calls_stuck_lanes_and_landing_times(self):
        items = [lane("a", "needs_action", "failed"), lane("b", "needs_action", "agent_gone"), lane("c", "running_long", "long"),
                 lane("d", "needs_action", "call"), lane("e", "waiting", "mate"), lane("f", "ok", "moving")]
        att = [{"id": "c1", "source": "home-a", "severity": "action"}, {"id": "c2", "source": "home-a", "severity": "info"},
               {"id": "c3", "source": "home-a", "severity": "critical"}]
        m = glance.marks(items, att, [NOW - 60, NOW - 7200, "bad", True])
        self.assertEqual(len(m["calls"]), 1)                       # only what waits on the viewer (severity action)
        self.assertEqual(len(m["stuck"]), 3)                       # failed, no agent, running long; a call counts as a call
        self.assertEqual(m["landed"], [NOW - 7200, NOW - 60])      # sorted, only numbers
        self.assertEqual(m["stuck"], sorted(m["stuck"]))
        self.assertTrue(all(len(k) == 12 and k not in ("a", "b", "c") for k in m["stuck"] + m["calls"]))   # opaque: no ids


class Delta(unittest.TestCase):
    def setUp(self):
        self.items = [lane("a", "needs_action", "failed"), lane("b", "needs_action", "blocked")]
        self.att = [{"id": "c1", "source": "home-a", "severity": "action"}, {"id": "c2", "source": "home-a", "severity": "action"}]
        self.now = glance.marks(self.items, self.att, [NOW - 600, NOW - 5 * 3600, NOW - 9 * 3600])

    def test_first_visit_and_unreadable_looks_say_nothing(self):
        for seen in (None, {}, {"at": "yesterday"}, {"at": True}, [], "x"):
            self.assertIsNone(glance.delta(seen, self.now, now=NOW), seen)

    def test_counts_what_is_new_since_the_last_look(self):
        before = glance.marks(self.items[:1], self.att[:1], [])
        d = glance.delta({"at": NOW - 6 * 3600, "calls": before["calls"], "stuck": before["stuck"]}, self.now, now=NOW)
        self.assertEqual((d["landed"], d["calls"], d["stuck"]), (2, 1, 1))
        self.assertEqual(d["away_s"], 6 * 3600)
        self.assertTrue(d["any"])

    def test_nothing_new_is_not_any(self):
        d = glance.delta({"at": NOW - 60, "calls": self.now["calls"], "stuck": self.now["stuck"]}, self.now, now=NOW)
        self.assertEqual((d["landed"], d["calls"], d["stuck"], d["any"]), (0, 0, 0, False))

    def test_a_short_absence_is_no_look_away(self):
        self.assertIsNone(glance.delta({"at": NOW - 300, "calls": [], "stuck": []}, self.now, min_away_s=600, now=NOW))
        self.assertIsNotNone(glance.delta({"at": NOW - 900, "calls": [], "stuck": []}, self.now, min_away_s=600, now=NOW))

    def test_a_cleared_call_is_not_counted_and_bad_lists_read_as_empty(self):
        d = glance.delta({"at": NOW - 60, "calls": "not a list", "stuck": None}, {"calls": [], "stuck": [], "landed": []}, now=NOW)
        self.assertEqual((d["calls"], d["stuck"], d["any"]), (0, 0, False))


class Projects(unittest.TestCase):
    def test_project_first_machine_second_no_project_last(self):
        items = [lane("1", "ok", "moving", "Zephyr", "m2"), lane("2", "waiting", "mate", "alpha-app", "m1"),
                 lane("3", "needs_action", "failed", "Alpha App", "m2"), lane("4", "ok", "moving", None, "m1"),
                 lane("5", "ok", "moving", "Zephyr", "m1")]
        groups, order = glance.projects(items, {"m1": "Beta box", "m2": "Alpha box"})
        self.assertEqual([g["key"] for g in groups], ["alpha app", "zephyr", None])   # case and hyphens fold together
        self.assertEqual(groups[0]["machines"], ["m2", "m1"])                         # by machine label, not id
        self.assertEqual((groups[0]["n"], groups[0]["off"], groups[0]["waiting"]), (2, 1, 1))
        self.assertEqual(order[("home-a", "3")], [0, 0])
        self.assertEqual(order[("home-a", "2")], [0, 1])
        self.assertEqual(order[("home-a", "5")], [1, 1])
        self.assertEqual(order[("home-a", "4")], [2, 0])

    def test_order_does_not_move_with_states(self):
        a = [lane("1", "ok", "moving", "Bravo", "m1"), lane("2", "ok", "moving", "Alpha", "m1")]
        b = [lane("1", "needs_action", "failed", "Bravo", "m1"), lane("2", "ok", "done", "Alpha", "m1")]
        self.assertEqual(glance.projects(a)[1], glance.projects(b)[1])

    def test_owner_names_the_row(self):
        it = lane("x", "ok", "moving", "P", "m1", source="relay")
        it["owner"] = "home-b"
        self.assertIn(("home-b", "x"), glance.projects([it])[1])


class Time(unittest.TestCase):
    def test_relative_words(self):
        self.assertEqual(glance.relative(NOW - 30, NOW), "just now")
        self.assertEqual(glance.relative(NOW + 30, NOW), "just now")
        self.assertEqual(glance.relative(NOW - 720, NOW), "12 min ago")
        self.assertEqual(glance.relative(NOW + 3 * 3600 + 600, NOW), "in 3 h 10 min")
        self.assertEqual(glance.relative(NOW - 2 * 86400 - 4 * 3600, NOW), "2 d 4 h ago")
        self.assertIsNone(glance.relative(None, NOW))
        self.assertIsNone(glance.relative(True, NOW))

    def test_age_in_state_on_every_kind_of_row(self):
        self.assertEqual(gaps.age_in_state({"state": "running", "started_at": iso(NOW - 600)}, NOW)["basis"], "started_at")
        held = gaps.age_in_state({"state": "waiting", "waiting_since": iso(NOW - 7200), "started_at": iso(NOW - 9000)}, NOW)
        self.assertEqual((held["s"], held["basis"]), (7200, "waiting_since"))
        own = gaps.age_in_state({"state": "blocked", "state_since": iso(NOW - 60), "started_at": iso(NOW - 9000)}, NOW)
        self.assertEqual(own["basis"], "state_since")              # the source's own time wins
        self.assertIsNone(gaps.age_in_state({"state": "blocked"}, NOW))   # never a guess
        self.assertIsNone(gaps.age_in_state({"state": "running", "started_at": iso(NOW + 3600)}, NOW))   # not from the future

    def test_oldest_waiting(self):
        items = [dict(lane("a", "waiting", "mate"), state="waiting", waiting_since=iso(NOW - 600)),
                 dict(lane("b", "needs_action", "blocked"), state="blocked", state_since=iso(NOW - 4000)),
                 dict(lane("c", "ok", "moving"), state="running", started_at=iso(NOW - 99999))]
        self.assertEqual(gaps.oldest_waiting(items, NOW)["id"], "b")


if __name__ == "__main__":
    unittest.main()
