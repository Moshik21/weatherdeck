"""Contract tests for what the board says about a source that slowed itself on purpose (unreleased, feed 1.4).

    python3 -m unittest discover -s tests

Added under the same deliberate, narrow exception as tests/test_contract.py, which the owner extended to this release
(CONTRIBUTING.md, "Tests"). They cover only pure core logic and the feed contract: the view's pace of a source
(src/weatherdeck/gaps.py `pace`) and the 1.4 `pace` field (src/weatherdeck/schema.py). Synthetic data only, standard library
only, no network, no clock: every time is passed in. Nothing here tests an adapter.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import gaps, schema  # noqa: E402

NOW = 1_800_000_000          # 2027-01-15T08:00:00Z, a fixed clock


def iso(t):
    import time
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def block(**kw):
    base = {"factor": 3, "why": ["load"], "since": iso(NOW - 240), "pass_s": 60, "normal_pass_s": 20, "keepalive_s": 180,
            "normal_keepalive_s": 60, "load_per_core": 3.1, "on_battery": False,
            "cost": {"cpu_s_per_h": 41.5, "budget_cpu_s_per_h": 60, "run_s": 2.4, "budget_run_s": 10, "over_budget": False,
                     "measured_s": 3600}}
    base.update(kw)
    return base


class PaceOfASource(unittest.TestCase):
    """A source's own word, said as it is: slowed on purpose, or nothing."""

    def test_a_source_with_no_pace_says_nothing(self):
        for none in (None, {}, "slow", [], {"factor": None}, {"factor": "3"}, {"factor": True}):
            self.assertIsNone(gaps.pace(none, NOW), none)

    def test_above_one_is_slowed_with_its_reasons_and_how_long(self):
        p = gaps.pace(block(), NOW)
        self.assertTrue(p["slowed"])
        self.assertEqual((p["factor"], p["why"], p["since_s"]), (3.0, ["load"], 240))
        self.assertEqual((p["pass_s"], p["normal_pass_s"], p["keepalive_s"], p["normal_keepalive_s"]), (60, 20, 180, 60))
        self.assertEqual(p["load_per_core"], 3.1)
        self.assertFalse(p["cost"]["over_budget"])

    def test_one_is_not_slowed_and_keeps_no_reason(self):
        p = gaps.pace(block(factor=1, why=["load"], since=iso(NOW - 60)), NOW)
        self.assertFalse(p["slowed"])
        self.assertEqual((p["why"], p["since_s"]), ([], None))

    def test_below_one_cannot_be_true_and_counts_as_one(self):
        p = gaps.pace(block(factor=0.2), NOW)
        self.assertEqual((p["slowed"], p["factor"]), (False, 1.0))

    def test_a_slowed_source_that_gives_no_reason_gives_none(self):
        self.assertEqual(gaps.pace(block(why=None), NOW)["why"], [])
        self.assertEqual(gaps.pace(block(why=["battery", 7, "future_reason"]), NOW)["why"], ["battery", "future_reason"])

    def test_unmeasured_stays_unmeasured_never_zero(self):
        p = gaps.pace(block(cost={"cpu_s_per_h": None, "run_s": None}), NOW)
        self.assertIsNone(p["cost"]["cpu_s_per_h"])
        self.assertIsNone(p["cost"]["run_s"])
        self.assertIsNone(p["cost"]["over_budget"])
        self.assertIsNone(gaps.pace(block(cost=None, load_per_core=None, on_battery=None), NOW)["load_per_core"])

    def test_a_since_in_the_future_never_reads_negative(self):
        self.assertEqual(gaps.pace(block(since=iso(NOW + 600)), NOW)["since_s"], 0)


class PaceInTheFeed(unittest.TestCase):
    """The 1.4 field: optional, typed when present, read by any 1.x host."""

    def doc(self, **extra):
        return dict({"schema": "lookout.feed", "schema_version": "1.4", "source": {"id": "src-a"}, "items": []}, **extra)

    def test_a_feed_without_pace_is_unchanged(self):
        clean, _ = schema.validate(self.doc())
        self.assertNotIn("pace", clean)

    def test_a_pace_object_passes_through(self):
        clean, _ = schema.validate(self.doc(pace=block()))
        self.assertEqual(clean["pace"]["factor"], 3)
        self.assertEqual(clean["pace"]["cost"]["cpu_s_per_h"], 41.5)

    def test_unknown_fields_in_pace_pass_through(self):
        clean, _ = schema.validate(self.doc(pace=block(note="later")))
        self.assertEqual(clean["pace"]["note"], "later")

    def test_wrong_types_are_rejected_with_their_path(self):
        for bad, path in (({"factor": "3"}, "pace.factor"), ({"why": "load"}, "pace.why"), ({"since": "yesterday"}, "pace.since"),
                          ({"on_battery": "no"}, "pace.on_battery"), ({"cost": {"cpu_s_per_h": "41"}}, "pace.cost.cpu_s_per_h"),
                          ({"pass_s": 1.5}, "pace.pass_s")):
            with self.assertRaises(schema.Reject) as caught:
                schema.validate(self.doc(pace=block(**bad)))
            self.assertIn(path, caught.exception.reason)

    def test_an_older_feed_version_is_still_read(self):
        clean, _ = schema.validate(dict(self.doc(), schema_version="1.2"))
        self.assertEqual(clean["source"]["id"], "src-a")


if __name__ == "__main__":
    unittest.main()
