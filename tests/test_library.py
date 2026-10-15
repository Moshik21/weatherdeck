"""Contract tests for the library (unreleased, feed 1.10: `mirrors[]`).

    python3 -m unittest discover -s tests

Added under the same deliberate, narrow exception as tests/test_gaps.py (CONTRIBUTING.md, "Tests"), for pure core logic and the
feed-spec contract only:
  - the one word per mirrored folder (src/weatherdeck/gaps.py `mirrors`): each of the eight words from its one rule, the order
    the rules are tried, unknown never reads up to date, a silent source keeps its last word, retired and not reporting only
    from a declaration, and the receipt's times moved to the host's clock;
  - the 1.10 field (src/weatherdeck/schema.py) and what the household and public views keep of it (src/weatherdeck/view.py).
Synthetic data only, standard library only, no network, no clock: every time is passed in.
"""
import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import gaps, schema, view  # noqa: E402

NOW = 1_800_000_000          # 2027-01-15T08:00:00Z, a fixed clock


def iso(t):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def mirror(**kw):
    """A fresh, healthy row: checked 5 min ago by a job that runs every 30 min (limit 90 min), nothing pending."""
    base = {"id": "notes-alpha", "label": "notes/alpha/", "ns": "notes/alpha", "interval_s": 1800, "stale_after_s": 5400,
            "checked_at": iso(NOW - 300), "outcome": "nothing_new", "changed_at": iso(NOW - 86400), "pending": {"files": 0, "since": None}}
    base.update(kw)
    return base


def rows_of(*ms, silent=False, generated_at=None, received_at=NOW):
    return [(m, "src-a", "box-a", generated_at or iso(received_at), received_at, silent) for m in ms]


def one(m, **kw):
    return gaps.mirrors(rows_of(m, **kw), NOW)[0]


class EachWord(unittest.TestCase):
    """Every word comes from its own rule and the fields that rule names."""

    def test_up_to_date_needs_a_fresh_receipt_an_ok_outcome_and_nothing_pending(self):
        for outcome in ("pushed", "nothing_new"):
            self.assertEqual(one(mirror(outcome=outcome))["state"], "up_to_date", outcome)
        self.assertTrue(one(mirror())["nothing_new"])
        self.assertFalse(one(mirror(outcome="pushed"))["nothing_new"])

    def test_waiting_counts_what_is_not_in_the_repository(self):
        r = one(mirror(outcome="pushed", pending={"files": 3, "since": iso(NOW - 4000)}))
        self.assertEqual((r["state"], r["pending"]), ("waiting", 3))

    def test_failing_for_every_failure_word(self):
        for word in gaps.MIRROR_FAILED:
            r = one(mirror(outcome=word, detail="the remote said no", failing_since=iso(NOW - 7200)))
            self.assertEqual(r["state"], "failing", word)
            self.assertEqual(r["detail"], "the remote said no")
            self.assertEqual(r["at"]["failing"], NOW - 7200)

    def test_not_checked_past_the_limit(self):
        r = one(mirror(checked_at=iso(NOW - 5401)))
        self.assertEqual((r["state"], r["checked_s"], r["limit_s"]), ("not_checked", 5401, 5400))
        self.assertEqual(one(mirror(checked_at=iso(NOW - 5400)))["state"], "up_to_date")

    def test_silent_keeps_the_word_it_had(self):
        for m, word in ((mirror(), "up_to_date"), (mirror(outcome="push_failed"), "failing"), (mirror(checked_at=iso(NOW - 9000)), "not_checked")):
            r = one(m, silent=True)
            self.assertEqual((r["state"], r["last_known"]), ("silent", word))

    def test_unknown_when_the_rules_cannot_read_it(self):
        for m in (mirror(checked_at=None), mirror(stale_after_s=None), mirror(outcome="pushed_partly"), mirror(outcome=None),
                  mirror(pending=None), mirror(pending={"files": None})):
            self.assertEqual(one(m)["state"], "unknown", m)

    def test_not_reporting_only_for_a_folder_the_config_expects(self):
        out = gaps.mirrors(rows_of(mirror()), NOW, expected=["notes/alpha", "/notes/beta/", {"ns": "notes/gamma"}])
        self.assertEqual({r["ns"]: r["state"] for r in out}, {"notes/alpha": "up_to_date", "notes/beta": "not_reporting", "notes/gamma": "not_reporting"})
        missing = next(r for r in out if r["ns"] == "notes/beta")
        self.assertEqual((missing["source"], missing["checked_s"], missing["pending"]), (None, None, None))
        self.assertEqual([r["ns"] for r in gaps.mirrors([], NOW)], [])

    def test_retired_only_by_a_declaration(self):
        dec = [{"ns": "notes/alpha", "since": "2027-01-10", "note": "folded into notes/main"}, {"ns": "notes/old", "since": "2027-01-01"}]
        out = {r["ns"]: r for r in gaps.mirrors(rows_of(mirror(outcome="push_failed")), NOW, retired=dec)}
        self.assertEqual((out["notes/alpha"]["state"], out["notes/alpha"]["since"], out["notes/alpha"]["note"]), ("retired", "2027-01-10", "folded into notes/main"))
        self.assertEqual((out["notes/old"]["state"], out["notes/old"]["source"]), ("retired", None))
        self.assertEqual(one(mirror(retired=True))["state"], "retired")
        # Age never retires a folder: a month-old receipt is not checked, not retired.
        self.assertEqual(one(mirror(checked_at=iso(NOW - 30 * 86400), changed_at=iso(NOW - 60 * 86400)))["state"], "not_checked")


class Order(unittest.TestCase):
    """The first rule that holds wins: retired, silent, failing, not checked, waiting, up to date, unknown."""

    def test_failing_before_not_checked(self):
        self.assertEqual(one(mirror(outcome="fetch_failed", checked_at=iso(NOW - 9000)))["state"], "failing")

    def test_not_checked_before_waiting(self):
        self.assertEqual(one(mirror(checked_at=iso(NOW - 9000), pending={"files": 2, "since": None}))["state"], "not_checked")

    def test_retired_before_silent(self):
        self.assertEqual(one(mirror(retired=True), silent=True)["state"], "retired")

    def test_rows_worst_first_then_by_label(self):
        out = gaps.mirrors(rows_of(mirror(id="b", label="b/", ns="b"), mirror(id="a", label="a/", ns="a"),
                                   mirror(id="c", label="c/", ns="c", outcome="push_failed"), mirror(id="d", label="d/", ns="d", checked_at=None)),
                           NOW, expected=["e"], retired=[{"ns": "f"}])
        self.assertEqual([(r["label"], r["state"]) for r in out],
                         [("c/", "failing"), ("d/", "unknown"), ("e/", "not_reporting"), ("a/", "up_to_date"), ("b/", "up_to_date"), ("f/", "retired")])


class HostClock(unittest.TestCase):
    """A receipt's times are the source's clock, moved to the host's by the source's own offset."""

    def test_a_skewed_source_is_aged_on_the_host_clock(self):
        received = NOW - 60
        gen = received - 7200            # the source's clock is two hours behind the host's
        m = mirror(checked_at=iso(gen - 600), changed_at=iso(gen - 3600))
        r = gaps.mirrors(rows_of(m, generated_at=iso(gen), received_at=received), NOW)[0]
        self.assertEqual((r["state"], r["checked_s"]), ("up_to_date", 660))
        self.assertEqual((r["at"]["checked"], r["at"]["changed"]), (received - 600, received - 3600))


class FeedContract(unittest.TestCase):
    def test_a_1_10_feed_with_mirrors_validates(self):
        doc = {"schema": "lookout.feed", "schema_version": "1.10", "source": {"id": "src-a"}, "generated_at": iso(NOW),
               "mirrors": [mirror(as_of=iso(NOW), repo="notes", files=45, changed=0, skipped=0, head="abc1234", origin_head="abc1234",
                                  verified_at=iso(NOW - 297), finished_at=iso(NOW - 297), changed_sha="def5678", failing_since=None, detail=None)]}
        clean, warn = schema.validate(doc)
        self.assertEqual((len(clean["mirrors"]), warn), (1, []))
        self.assertEqual(schema.validate({"schema": "lookout.feed", "schema_version": "1.9", "source": {"id": "src-a"}})[0]["mirrors"], [])

    def test_at_most_eight_rows_and_typed_fields(self):
        base = {"schema": "lookout.feed", "schema_version": "1.10", "source": {"id": "src-a"}}
        with self.assertRaises(schema.Reject):
            schema.validate(dict(base, mirrors=[mirror(id="m%d" % i) for i in range(9)]))
        for bad in (mirror(checked_at="yesterday"), mirror(pending={"files": "none"}), mirror(retired="yes"), {"label": "no id"}):
            with self.assertRaises(schema.Reject):
                schema.validate(dict(base, mirrors=[bad]))


class Views(unittest.TestCase):
    def blank(self):
        rows = gaps.mirrors(rows_of(mirror(outcome="push_failed", detail="the remote said no")), NOW,
                            retired=[{"ns": "notes/old", "since": "2027-01-01", "note": "folded into notes/main"}])
        return {"cards": [], "sources": [], "items": [], "attention": [], "attention_pending": [], "next": [], "done": [], "groups": [],
                "machines": [], "history": {"timeline": [], "notes": []},
                "gaps": {"waits_outside": [], "oldest_waiting": None, "queues": [], "coming_up": [], "deploys": [], "mirrors": rows}}

    def test_household_and_guest_keep_folder_word_and_ages_and_drop_the_words(self):
        for level in ("household", "guest"):
            v = self.blank()
            view.redact(v, level, {})
            failing, retired = v["gaps"]["mirrors"]
            self.assertEqual((failing["label"], failing["state"], failing["checked_s"]), ("notes/alpha/", "failing", 300), level)
            self.assertEqual((failing["detail"], retired["note"], retired["since"]), (None, None, "2027-01-01"), level)

    def test_public_has_no_library(self):
        v = self.blank()
        view.redact(v, "public", {})
        self.assertEqual(v["gaps"]["mirrors"], [])


if __name__ == "__main__":
    unittest.main()
