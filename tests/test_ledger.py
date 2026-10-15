"""Contract tests for the tool value ledger reader and its reading rule (src/weatherdeck/ledger.py, docs/ledger-spec.md).

Added under the owner's narrow exception (CONTRIBUTING.md): pure core logic, synthetic data (made-up hosts and counts),
standard library, no network, every time passed in. The one file it touches is a temporary ledger it writes itself.
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import ledger  # noqa: E402

DAY = 86400
TO = 1800000000 - 1800000000 % DAY        # a day boundary
LO = TO - 14 * DAY
DIGEST = "sha256:" + "ab" * 32


def row(tool, counter, host, day, value, unknown=None, quality="exact", covers=1.0, **extra):
    """One synthetic reading of `counter` for the day that starts `day` days after the start of the window."""
    frm = LO + day * DAY
    rec = {"v": 1, "id": "%s@%s@%d" % (counter, host, frm), "tool": tool, "counter": counter, "host": host,
           "window": {"from": frm, "to": frm + DAY}, "value": value, "unknown": unknown, "quality": quality,
           "coverage": {"first_at": frm, "last_at": frm + DAY - 1, "rows": 3, "covers_window": covers},
           "read_at": TO, "reader": "synthetic/1", "supersedes": None}
    if value is not None:
        rec["src"] = {"kind": "jsonl", "file": "records.jsonl", "filter": "kind=x", "first_ref": "line:1", "last_ref": "line:2", "digest": DIGEST}
        rec["excluded"] = {}
    rec.update(extra)
    return rec


def days(tool, counter, host, values, first=0, **kw):
    return [row(tool, counter, host, first + i, v, **kw) for i, v in enumerate(values)]


def text(rows):
    return "\n".join(json.dumps(r) for r in rows) + "\n"


def run(rows, **kw):
    return ledger.assess(ledger.parse(text(rows)), TO, **kw)


def unknown_days(tool, counter, host, why, first=0, n=14):
    return [row(tool, counter, host, first + i, None, why, covers=0.0) for i in range(n)]


class Lines(unittest.TestCase):
    def test_unknown_is_a_line_with_a_reason_and_never_zero(self):
        r = run(unknown_days("doctor", "repairs_verified", "host-a", "no-state-dir"))
        c = r["counters"]["repairs_verified"]
        self.assertIsNone(c["value"])
        self.assertEqual((c["unknown"], c["status"], c["coverage"]), ("no-state-dir", "blind", 0.0))
        self.assertEqual(r["verdict"]["reading"], "UNMEASURED")

    def test_a_missing_counter_is_unknown_not_zero(self):
        c = run(days("doctor", "repairs_verified", "host-a", [1] * 14))["counters"]["judged_real"]
        self.assertEqual((c["value"], c["unknown"], c["status"]), (None, "no-reading", "blind"))

    def test_bad_lines_are_skipped_and_listed_and_the_rest_used(self):
        good = row("doctor", "repairs_verified", "host-a", 0, 2)
        zero = row("doctor", "repairs_verified", "host-a", 1, 0, covers=0.6)
        nodigest = row("doctor", "repairs_verified", "host-a", 2, 4)
        nodigest["src"]["digest"] = "sha256:short"
        path = row("doctor", "repairs_verified", "host-a", 3, 4)
        path["src"]["file"] = "/var/x/records.jsonl"
        noreason = row("doctor", "repairs_verified", "host-a", 4, None)
        dup = dict(good)
        other = row("preflight", "gate_go", "host-a", 5, 1)
        raw = text([good, zero, nodigest, path, noreason, dup, other]) + "{torn\n\n"
        p = ledger.parse(raw)
        self.assertEqual([r["id"] for r in p["active"]], [good["id"]])
        self.assertEqual([s["reason"] for s in p["skipped"]],
                         ["zero-without-coverage", "number-without-digest", "bad-src-file", "unknown-without-reason",
                          "duplicate-id", "wrong-tool", "not-json"])

    def test_a_retired_word_counter_is_a_placeholder_and_a_number_under_it_is_skipped(self):
        self.assertIsNone(ledger.check(row("harbor", "minutes_saved", "host-a", 0, None, "not-measurable")))
        self.assertIsNone(ledger.check(row("weatherdeck", "caught", "host-a", 0, None, "not-measurable")))
        self.assertEqual(ledger.check(row("harbor", "minutes_saved", "host-a", 0, 40)), "retired-word-in-counter")
        self.assertEqual(ledger.check(row("weatherdeck", "caught", "host-a", 0, 1)), "retired-word-in-counter")
        self.assertEqual(ledger.check(row("weatherdeck", "caught", "host-a", 0, None)), "unknown-without-reason")
        self.assertIsNone(ledger.check(row("weatherdeck", "uncaughtable", "host-a", 0, 1)))

    def test_a_correction_supersedes_and_the_old_line_stops_counting(self):
        a = row("doctor", "repairs_verified", "host-a", 0, 5)
        b = row("doctor", "repairs_verified", "host-a", 0, 2, id=a["id"] + "#2", supersedes=a["id"])
        ghost = row("doctor", "repairs_verified", "host-a", 1, 1, supersedes="never-written")
        p = ledger.parse(text([a, b, ghost]))
        self.assertEqual(sorted(r["id"] for r in p["active"]), sorted([b["id"], ghost["id"]]))
        self.assertEqual((p["superseded"], p["dangling"]), (1, ["never-written"]))

    def test_a_hand_label_is_never_summed(self):
        rows = days("doctor", "repairs_verified", "host-a", [1] * 14) + [row("doctor", "judged_real", "host-a", 0, 9, quality="labelled-offline")]
        c = run(rows)["counters"]["judged_real"]
        self.assertEqual((c["value"], c["status"]), (None, "blind"))


class Coverage(unittest.TestCase):
    def test_a_missing_day_is_no_coverage_and_makes_the_sum_a_lower_bound(self):
        c = run(days("doctor", "repairs_verified", "host-a", [1] * 12))["counters"]["repairs_verified"]
        self.assertEqual((c["value"], c["quality"], c["status"]), (12, "lower-bound", "partial"))
        self.assertAlmostEqual(c["coverage"], 12 / 14, places=3)

    def test_a_host_that_never_wrote_lowers_coverage_only_when_it_is_expected(self):
        rows = days("doctor", "repairs_verified", "host-a", [1] * 14)
        self.assertEqual(run(rows)["counters"]["repairs_verified"]["coverage"], 1.0)
        self.assertEqual(run(rows, expected_hosts=["host-b"])["counters"]["repairs_verified"]["coverage"], 0.5)

    def test_overlapping_readings_are_a_conflict_not_a_double_count(self):
        rows = days("doctor", "repairs_verified", "host-a", [1] * 14) + [row("doctor", "repairs_verified", "host-a", 3, 1, id="x")]
        c = run(rows)["counters"]["repairs_verified"]
        self.assertEqual((c["value"], c["unknown"]), (None, "conflict"))

    def test_max_counters_take_the_worst_reading_not_a_sum(self):
        rows = days("doctor", "took_ms_p95", "host-a", [10, 40, 25] + [5] * 11, combine="max")
        self.assertEqual(run(rows)["counters"]["took_ms_p95"]["value"], 40)

    def test_lines_that_straddle_the_window_are_not_counted(self):
        r = row("doctor", "repairs_verified", "host-a", 13, 3, window={"from": LO + 13 * DAY, "to": TO + DAY})
        c = run([r])["counters"]["repairs_verified"]
        self.assertEqual((c["value"], c["outside"]), (None, 1))


class Reading(unittest.TestCase):
    def test_keep_when_a_covered_window_shows_a_value_event(self):
        r = run(days("doctor", "repairs_verified", "host-a", [0] * 13 + [2]) + unknown_days("doctor", "judged_real", "host-a", "field-absent"))
        self.assertEqual(r["verdict"]["reading"], "KEEP")
        self.assertEqual((r["verdict"]["events"], r["verdict"]["verbs"]), ({"repairs_verified": 2}, {"repairs_verified": "repaired and verified"}))
        self.assertEqual(r["verdict"]["cannot_cite"], [])

    def test_quiet_when_every_value_counter_is_covered_and_empty(self):
        rows = days("doctor", "repairs_verified", "host-a", [0] * 14) + days("doctor", "judged_real", "host-a", [0] * 14)
        self.assertEqual(run(rows)["verdict"]["reading"], "QUIET")

    def test_unmeasured_when_a_value_counter_is_unknown_even_at_zero_elsewhere(self):
        rows = days("doctor", "repairs_verified", "host-a", [0] * 14) + unknown_days("doctor", "judged_real", "host-a", "field-absent")
        v = run(rows)["verdict"]
        self.assertEqual(v["reading"], "UNMEASURED")
        self.assertEqual(v["why"], ["judged_real blind"])

    def test_two_quiet_windows_in_a_row_are_a_cut_candidate(self):
        rows = []
        for c in ("repairs_verified", "judged_real"):
            rows += days("doctor", c, "host-a", [0] * 28, first=-14)
        v = run(rows)["verdict"]
        self.assertEqual((v["reading"], v["previous"]), ("CUT-CANDIDATE", "QUIET"))

    def test_three_quiet_windows_are_needed_when_the_rule_says_three(self):
        two, three = [], []
        for c in ("repairs_verified", "judged_real"):
            two += days("doctor", c, "host-a", [0] * 28, first=-14)
            three += days("doctor", c, "host-a", [0] * 42, first=-28)
        self.assertEqual(run(two, rules={"quiet_windows_for_cut": 3})["verdict"]["reading"], "QUIET")
        v = run(three, rules={"quiet_windows_for_cut": 3})["verdict"]
        self.assertEqual((v["reading"], v["previous"]), ("CUT-CANDIDATE", "QUIET"))
        self.assertEqual(v["why"], ["no value event in 3 covered windows in a row"])

    def test_one_quiet_window_is_a_cut_when_the_rule_says_one(self):
        rows = days("doctor", "repairs_verified", "host-a", [0] * 14) + days("doctor", "judged_real", "host-a", [0] * 14)
        v = run(rows, rules={"quiet_windows_for_cut": 1})["verdict"]
        self.assertEqual((v["reading"], v["previous"]), ("CUT-CANDIDATE", "UNMEASURED"))

    def test_a_quiet_window_after_an_unmeasured_one_is_not_a_cut(self):
        rows = days("doctor", "repairs_verified", "host-a", [0] * 14) + days("doctor", "judged_real", "host-a", [0] * 14)
        rows += days("doctor", "repairs_verified", "host-a", [0] * 14, first=-14)
        v = run(rows)["verdict"]
        self.assertEqual((v["reading"], v["previous"]), ("QUIET", "UNMEASURED"))

    def test_partial_coverage_never_reads_quiet_or_cut(self):
        rows = days("doctor", "repairs_verified", "host-a", [0] * 9) + days("doctor", "judged_real", "host-a", [0] * 14)
        self.assertEqual(run(rows)["verdict"]["reading"], "UNMEASURED")

    def test_partial_coverage_with_events_is_a_keep_that_cannot_be_cited(self):
        rows = days("doctor", "repairs_verified", "host-a", [1] * 10) + days("doctor", "judged_real", "host-a", [0] * 14)
        v = run(rows)["verdict"]
        self.assertEqual((v["reading"], v["lower_bound"]), ("KEEP", True))
        self.assertIn("repairs_verified is partial", v["cannot_cite"])

    def test_doctor_judged_wrong_share_over_thirty_percent_is_a_cut_candidate(self):
        rows = days("doctor", "judged_real", "host-a", [1] * 14) + days("doctor", "judged_wrong", "host-a", [1] * 14)
        rows += days("doctor", "repairs_verified", "host-a", [1] * 14)
        v = run(rows)["verdict"]
        self.assertEqual(v["reading"], "CUT-CANDIDATE")
        self.assertTrue(v["why"][0].startswith("judged_wrong_share"))

    def test_a_share_on_blind_counters_is_not_a_cut(self):
        rows = days("doctor", "judged_real", "host-a", [1] * 14) + unknown_days("doctor", "judged_wrong", "host-a", "field-absent")
        self.assertEqual(run(rows)["verdict"]["reading"], "KEEP")

    def test_preflight_overrides_over_half_the_refusals_is_a_cut_candidate(self):
        rows = days("preflight", "gate_refused", "host-a", [1] * 14) + days("preflight", "overrides", "host-a", [1] * 10)
        rows += days("preflight", "overrides", "host-a", [0] * 4, first=10)
        rows += days("preflight", "refusals_stood", "host-a", [1] * 14)
        self.assertEqual(run(rows)["verdict"]["reading"], "CUT-CANDIDATE")

    def test_harbor_with_no_drain_record_cannot_be_quiet(self):
        rows = days("harbor", "gate_refused", "host-a", [0] * 14) + days("harbor", "passport_confirmed", "host-a", [0] * 14)
        rows += unknown_days("harbor", "drains_completed", "host-a", "field-absent")
        self.assertEqual(run(rows)["verdict"]["reading"], "UNMEASURED")

    def test_a_cost_clause_runs_only_when_a_tool_declares_one(self):
        rows = days("doctor", "repairs_verified", "host-a", [0] * 14) + days("doctor", "judged_real", "host-a", [0] * 14)
        rows += days("doctor", "took_ms_p95", "host-a", [900] * 14, combine="max")
        self.assertEqual(run(rows)["verdict"]["reading"], "QUIET")
        rules = {"cost": {"doctor": {"counter": "took_ms_p95", "budget": 500}}}
        self.assertEqual(run(rows, rules=rules)["verdict"]["reading"], "CUT-CANDIDATE")

    def test_a_tool_with_no_rule_is_unmeasured(self):
        r = run(days("newtool", "things", "host-a", [3] * 14))
        self.assertEqual((r["verdict"]["reading"], r["verdict"]["why"]), ("UNMEASURED", ["no-rule-for-tool"]))
        self.assertEqual(r["counters"]["things"]["value"], 42)


class RenamedTools(unittest.TestCase):
    """Harbor, Doctor and Preflight are now Lodgings, Infirmary and Seaworthy; the reader accepts both names, read the same."""
    PAIRS = (("harbor", "lodgings"), ("doctor", "infirmary"), ("preflight", "seaworthy"))

    def rows(self, tool):
        return {
            "harbor": days(tool, "gate_refused", "host-a", [1] * 14) + days(tool, "passport_confirmed", "host-a", [2] * 14),
            "doctor": days(tool, "repairs_verified", "host-a", [1] * 14) + days(tool, "judged_real", "host-a", [0] * 14),
            "preflight": days(tool, "refusals_stood", "host-a", [1] * 14) + days(tool, "overrides", "host-a", [0] * 14)
            + days(tool, "gate_refused", "host-a", [1] * 14),
        }[{"lodgings": "harbor", "infirmary": "doctor", "seaworthy": "preflight"}.get(tool, tool)]

    def test_a_new_name_reads_the_same_as_the_old_name(self):
        for old, new in self.PAIRS:
            a, b = run(self.rows(old)), run(self.rows(new))
            self.assertEqual((a["tool"], b["tool"]), (old, new))
            self.assertEqual(a["verdict"], b["verdict"])
            self.assertEqual(a["counters"], b["counters"])
            self.assertEqual(a["verdict"]["reading"], "KEEP")
            self.assertTrue(a["verdict"]["verbs"])

    def test_an_old_name_still_reads_in_its_old_verbs(self):
        v = run(self.rows("harbor"))["verdict"]
        self.assertEqual(v["verbs"], {"gate_refused": "refused", "passport_confirmed": "moved"})
        self.assertEqual(run(self.rows("doctor"))["verdict"]["verbs"], {"repairs_verified": "repaired and verified"})
        self.assertEqual(run(self.rows("lodgings"))["verdict"]["verbs"], v["verbs"])

    def test_a_new_name_keeps_the_shares_of_its_old_name(self):
        for tool in ("doctor", "infirmary"):
            rows = days(tool, "judged_real", "host-a", [2] * 14) + days(tool, "judged_wrong", "host-a", [2] * 14)
            self.assertEqual(run(rows)["verdict"]["reading"], "CUT-CANDIDATE")
        for tool in ("preflight", "seaworthy"):
            rows = days(tool, "overrides", "host-a", [2] * 14) + days(tool, "gate_refused", "host-a", [2] * 14)
            rows += days(tool, "refusals_stood", "host-a", [1] * 14)
            self.assertEqual(run(rows)["verdict"]["reading"], "CUT-CANDIDATE")

    def test_a_value_counter_a_tool_does_not_record_stays_unknown(self):
        rows = days("lodgings", "gate_refused", "host-a", [1] * 14)
        c = run(rows)["counters"]["passport_confirmed"]
        self.assertEqual((c["value"], c["unknown"], c["status"]), (None, "no-reading", "blind"))

    def test_the_reader_does_not_map_one_name_onto_the_other(self):
        parsed = ledger.parse(text(days("lodgings", "gate_refused", "host-a", [1] * 2)), tool="harbor")
        self.assertEqual((len(parsed["active"]), [s["reason"] for s in parsed["skipped"]]), (0, ["wrong-tool"] * 2))

    def test_a_tool_name_with_no_profile_reads_as_before(self):
        for name in ("lodging", "infirmaries", "newtool"):
            r = run(days(name, "gate_refused", "host-a", [3] * 14))
            self.assertEqual((r["verdict"]["reading"], r["verdict"]["why"], r["verdict"]["verbs"]), ("UNMEASURED", ["no-rule-for-tool"], {}))
            self.assertEqual(r["counters"]["gate_refused"]["value"], 42)


class Citing(unittest.TestCase):
    def keep(self, hosts, **kw):
        rows = []
        for h in hosts:
            rows += days("harbor", "gate_refused", h, [1] * 14, **kw) + days("harbor", "passport_confirmed", h, [0] * 14)
            rows += days("harbor", "drains_completed", h, [0] * 14)
        return rows

    def test_an_exact_covered_keep_on_two_hosts_may_be_cited_in_the_record_verb(self):
        v = run(self.keep(["host-a", "host-b"]))["verdict"]
        self.assertEqual((v["reading"], v["cannot_cite"], v["verbs"]), ("KEEP", [], {"gate_refused": "refused"}))

    def test_an_estimate_a_short_window_or_one_contributing_host_may_not(self):
        v = run(self.keep(["host-a"], quality="estimate"))["verdict"]
        self.assertEqual(v["cannot_cite"], ["gate_refused is estimate"])
        v = run(self.keep(["host-a"]), expected_hosts=["host-b"])["verdict"]
        self.assertIn("fewer than 2 hosts contributed", v["cannot_cite"])

    def test_a_window_under_fourteen_days_may_not(self):
        rows = []
        for c, v in (("gate_refused", 1), ("passport_confirmed", 0), ("drains_completed", 0)):
            rows += days("harbor", c, "host-a", [v] * 7, first=7)
        r = ledger.assess(ledger.parse(text(rows)), TO, days=7)
        self.assertEqual((r["verdict"]["reading"], r["verdict"]["cannot_cite"]), ("KEEP", ["window is under 14 days"]))


class ReadingAFile(unittest.TestCase):
    def test_a_missing_file_is_every_counter_unknown_and_unmeasured(self):
        with tempfile.TemporaryDirectory() as d:
            r = ledger.read(os.path.join(d, "nothing.jsonl"), TO, tool="doctor")
            self.assertEqual(os.listdir(d), [])
        self.assertEqual((r["file"]["state"], r["verdict"]["reading"]), ("missing", "UNMEASURED"))
        self.assertEqual(r["counters"]["repairs_verified"]["unknown"], "no-ledger")

    def test_a_file_is_read_and_left_as_it_was(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "doctor.jsonl")
            body = text(days("doctor", "repairs_verified", "host-a", [1] * 14)) + "garbage\n"
            with open(path, "w") as f:
                f.write(body)
            r = ledger.read(path, TO)
            with open(path) as f:
                self.assertEqual(f.read(), body)
        self.assertEqual((r["tool"], r["counters"]["repairs_verified"]["value"], r["file"]["skipped"]), ("doctor", 14, [{"line": 15, "reason": "not-json"}]))


if __name__ == "__main__":
    unittest.main()
