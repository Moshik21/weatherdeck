"""Contract tests for the ledger cards (src/weatherdeck/ledgercards.py, docs/ADDINS.md "Ledger cards").

Added under the owner's narrow exception (CONTRIBUTING.md): pure core logic, synthetic data (made-up hosts and counts),
standard library, no network, every time passed in. The files it touches are temporary ledgers it writes itself.
"""
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))

from weatherdeck import cards, ledger, ledgercards  # noqa: E402
import test_ledger as fx  # noqa: E402

NOW = fx.TO + 3600
RETIRED = re.compile(r"caught|saved|prevent|avert|avoid|spared|rescued", re.I)


def card(tool, rows, **kw):
    return ledgercards.card(tool, "ok", ledger.assess(ledger.parse(fx.text(rows)), fx.TO, **kw), NOW)


def valid(doc):
    return cards.validate(doc, NOW)


class WhatTheCardSays(unittest.TestCase):
    def test_a_missing_or_unreadable_ledger_is_no_ledger_yet_and_never_a_number(self):
        for state in ("missing", "unreadable"):
            c = valid(ledgercards.card("doctor", state, None, NOW))
            self.assertEqual((c["status"], c["mode"]), ("unknown", "unmeasured"))
            self.assertTrue(c["headline"].startswith("No ledger yet"))
            self.assertNotIn("numbers", c)

    def test_a_counter_nobody_could_read_says_why_and_is_not_zero(self):
        c = valid(card("doctor", fx.unknown_days("doctor", "repairs_verified", "host-a", "field-absent")))
        self.assertEqual((c["status"], c["mode"]), ("unknown", "unmeasured"))
        self.assertEqual(c["numbers"][0], {"label": "repairs verified", "value": "unknown: not recorded yet"})

    def test_a_covered_event_is_keep_in_the_records_own_verb(self):
        c = valid(card("doctor", fx.days("doctor", "repairs_verified", "host-a", [1, 0, 2] + [0] * 11)))
        self.assertEqual((c["status"], c["mode"]), ("ok", "keep"))
        self.assertIn("3 repaired and verified", c["headline"])
        self.assertEqual(c["numbers"][0]["value"], 3)

    def test_a_covered_quiet_window_is_quiet_and_a_zero_is_a_covered_zero(self):
        rows = [r for c in ("refusals_stood", "overrides", "gate_refused") for r in fx.days("preflight", c, "host-a", [0] * 14)]
        c = valid(card("preflight", rows))
        self.assertEqual((c["status"], c["mode"]), ("ok", "quiet"))
        self.assertEqual([n["value"] for n in c["numbers"]], [0, 0, 0])

    def test_two_quiet_windows_are_a_cut_candidate_that_a_person_decides(self):
        rows = [r for c in ("refusals_stood", "overrides", "gate_refused") for r in fx.days("preflight", c, "host-a", [0] * 28, first=-14)]
        c = valid(card("preflight", rows))
        self.assertEqual((c["status"], c["mode"]), ("warn", "cut-candidate"))
        self.assertIn("A person decides", c["headline"])

    def test_a_partial_counter_is_at_least_and_a_blind_one_withholds_its_number(self):
        rows = fx.days("harbor", "gate_refused", "host-a", [1] * 12, first=2, covers=0.8) + fx.days("harbor", "passport_confirmed", "host-a", [1] * 3, first=11)
        c = valid(card("harbor", rows))
        by = {n["label"]: n["value"] for n in c["numbers"]}
        self.assertEqual(by["gate refused"], "at least 12, 68% covered")
        self.assertEqual(by["passport confirmed"], "unknown: 21% covered")
        self.assertIn("at least", c["headline"])

    def test_no_card_is_ever_said_in_a_retired_word(self):
        rows = fx.days("doctor", "repairs_verified", "host-a", [1] * 14)
        for c in (card("doctor", rows), card("doctor", []), ledgercards.card("doctor", "missing", None, NOW)):
            self.assertIsNone(RETIRED.search(" ".join([c["title"], c["headline"]] + [str(n["value"]) + n["label"] for n in c.get("numbers", [])])))

    def test_a_counter_name_outside_the_vocabulary_is_never_printed(self):
        rows = fx.days("doctor", "repairs_verified", "host-a", [1] * 14) + fx.days("doctor", "faults_spotted", "host-a", [2] * 14)
        c = valid(card("doctor", rows))
        self.assertEqual(c["numbers"][-1], {"label": "other counter, not in vocabulary", "value": 28})
        self.assertNotIn("faults", " ".join(n["label"] for n in c["numbers"]))

    def test_a_retired_word_placeholder_is_counted_as_not_measured_and_never_named(self):
        rows = (fx.days("harbor", "gate_refused", "host-a", [1] * 14) + fx.unknown_days("harbor", "minutes_saved", "host-a", "not-measurable")
                + fx.unknown_days("harbor", "faults_caught", "host-a", "not-measurable"))
        c = valid(card("harbor", rows))
        self.assertEqual((c["status"], c["mode"]), ("ok", "keep"))
        self.assertEqual(c["numbers"][0], {"label": "gate refused", "value": 14})
        self.assertEqual(c["numbers"][-1], {"label": "not measured", "value": "2 counters"})
        self.assertNotIn("skipped", c["headline"])
        self.assertIsNone(RETIRED.search(" ".join([c["title"], c["headline"]] + [str(n["value"]) + n["label"] for n in c["numbers"]])))

    def test_a_number_under_a_retired_word_makes_the_ledger_not_valid(self):
        for name in ("minutes_saved", "faults_caught", "rescued"):
            rows = fx.days("doctor", "repairs_verified", "host-a", [1] * 14) + fx.days("doctor", name, "host-a", [2] * 14)
            c = valid(card("doctor", rows))
            self.assertEqual((c["status"], c["mode"]), ("unknown", "unmeasured"))
            self.assertEqual(c["headline"], "Ledger not valid: a counter name uses a retired word")
            self.assertNotIn("numbers", c)
            self.assertIsNone(RETIRED.search(c["title"] + c["headline"]))

    def test_coverage_is_rounded_down_without_float_error_and_partial_never_reads_ninety(self):
        base = {"value": 5, "status": "partial", "quality": "lower-bound", "unknown": None}
        self.assertEqual(ledgercards.say(dict(base, coverage=0.29)), "at least 5, 29% covered")
        rows = fx.days("harbor", "gate_refused", "host-a", [1] * 14, covers=0.89996)
        c = card("harbor", rows)
        self.assertEqual({n["label"]: n["value"] for n in c["numbers"]}["gate refused"], "at least 14, 89% covered")

    def test_more_counters_than_six_are_counted_not_dropped_quietly(self):
        rows = fx.days("doctor", "repairs_verified", "host-a", [1] * 14)
        for i in range(8):
            rows += fx.days("doctor", "extra_%d" % i, "host-a", [1] * 14)
        c = valid(card("doctor", rows))
        self.assertEqual(len(c["numbers"]), 6)
        self.assertEqual(c["numbers"][-1], {"label": "more counters", "value": "+6 not shown"})


class WhenItIsOn(unittest.TestCase):
    def build(self, cfg, folder, now=NOW):
        self.addCleanup(setattr, ledgercards, "settings", ledgercards.settings)
        ledgercards.settings = lambda: dict(cfg, dir=folder)
        return ledgercards.build(now)

    def test_off_by_default_and_it_reads_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(self.build({"enabled": False, "tools": ["doctor"]}, d), [])

    def test_on_gives_one_card_per_tool_and_a_missing_file_is_no_ledger_yet(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "doctor.jsonl"), "w") as f:
                f.write(fx.text(fx.days("doctor", "repairs_verified", "host-a", [1] * 14)))
            out = self.build({"enabled": True, "tools": ["doctor", "harbor", "../x"]}, d)
        self.assertEqual([c["tool"] for c in out], ["ledger-doctor", "ledger-harbor"])
        self.assertEqual(out[0]["mode"], "keep")
        self.assertTrue(out[1]["headline"].startswith("No ledger yet"))

    def test_a_dropped_card_cannot_take_a_ledger_tool_id_while_ledger_cards_are_on(self):
        self.addCleanup(setattr, ledgercards, "settings", ledgercards.settings)
        self.addCleanup(setattr, cards, "drop_dir", cards.drop_dir)
        with tempfile.TemporaryDirectory() as d:
            drop = os.path.join(d, "cards")
            cards.put(drop, {"schema": "lookout.card", "schema_version": "1.0", "tool": "ledger-doctor", "title": "Doctor ledger",
                             "status": "ok", "headline": "Keep.", "updated_at": "2026-01-01T00:00:00Z"})
            cards.drop_dir = lambda: drop
            ledgercards.settings = lambda: {"enabled": True, "tools": ["doctor"], "dir": d}
            shown, rejected = cards.view(NOW)
            self.assertEqual([c["tool"] for c in shown], ["ledger-doctor"])
            self.assertTrue(shown[0]["headline"].startswith("No ledger yet"))
            self.assertEqual(rejected, 1)
            ledgercards.settings = lambda: {"enabled": False}
            shown, rejected = cards.view(NOW)
            self.assertEqual(([c["headline"] for c in shown], rejected), (["Keep."], 0))

    def test_a_file_over_the_limit_or_a_symlink_is_not_read(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "doctor.jsonl"), "w") as f:
                f.write("x" * 3000)
            os.symlink(os.path.join(d, "doctor.jsonl"), os.path.join(d, "harbor.jsonl"))
            out = self.build({"enabled": True, "tools": ["doctor", "harbor"], "max_kb": 1}, d)
        self.assertTrue(out[0]["headline"].startswith("No ledger read"))
        self.assertTrue(out[1]["headline"].startswith("No ledger yet"))
        self.assertTrue(all(c["status"] == "unknown" for c in out))


if __name__ == "__main__":
    unittest.main()
