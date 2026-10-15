"""Contract tests for calls that must not read as current when they are not (unreleased, feed 1.8: `attention[].as_of`).

    python3 -m unittest discover -s tests

Added under the same deliberate, narrow exception as tests/test_lanestate.py (CONTRIBUTING.md, "Tests"), for pure core logic and the
feed-spec contract only: the 1.8 field in `src/weatherdeck/schema.py`, how old a call's answer is on the host's clock against the source's
own limit for it (`src/weatherdeck/gaps.py` `freshness`: one old, one fresh), the host's merge of a call two homes both list
(`src/weatherdeck/view.py` `relayed_copy_dropped`: the owner answered and dropped it, so the relayed copy shows no card). Synthetic data only, standard library only, no network, no clock:
every time is passed in. Nothing here runs a pusher's collectors or the page.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import gaps, schema, view  # noqa: E402

GEN = "2027-01-15T08:00:00Z"
RECV = 1_800_000_000.0   # the host's receipt time; `now` below is passed in too


def feed(*ids):
    return {"feed": {"attention": [{"id": i, "kind": "decision", "severity": "action"} for i in ids]}}


class OwnerAnswered(unittest.TestCase):
    """hold:<owner>/<task> is the same call in the owner's feed and in a home that relays it."""

    def drop(self, feeds, sid, cid, known=None):
        return view.relayed_copy_dropped(sid, cid, feeds, known if known is not None else set(feeds), view.owned_call_keys(feeds))

    def test_two_sources_share_a_hold_id_and_the_owner_dropped_it_so_no_card(self):
        feeds = {"home-a": feed(), "home-b": feed("hold:home-a/task-1")}
        self.assertTrue(self.drop(feeds, "home-b", "hold:home-a/task-1"))

    def test_the_owner_still_lists_it_so_the_relayed_copy_merges_by_id(self):
        feeds = {"home-a": feed("hold:home-a/task-1"), "home-b": feed("hold:home-a/task-1")}
        self.assertFalse(self.drop(feeds, "home-b", "hold:home-a/task-1"))
        self.assertFalse(self.drop(feeds, "home-a", "hold:home-a/task-1"))

    def test_an_owner_that_is_no_source_defers_to_a_source_that_owns_the_call(self):
        feeds = {"home-b": feed("hold:home-z/task-1")}
        self.assertFalse(self.drop(feeds, "home-b", "hold:home-z/task-1"))
        feeds = {"atlas-main": feed("hold:atlas-main/task-1"), "home-b": feed("hold:atlas/task-1")}
        self.assertTrue(self.drop(feeds, "home-b", "hold:atlas/task-1"))

    def test_a_known_owner_that_has_sent_no_feed_is_not_reporting(self):
        feeds = {"home-b": feed("hold:home-a/task-1")}
        self.assertFalse(self.drop(feeds, "home-b", "hold:home-a/task-1", known={"home-a", "home-b"}))

    def test_another_owner_with_the_same_task_name_does_not_keep_it(self):
        feeds = {"home-a": feed(), "home-c": feed("hold:home-c/task-1"), "home-b": feed("hold:home-a/task-1")}
        self.assertTrue(self.drop(feeds, "home-b", "hold:home-a/task-1"))

    def test_a_card_that_is_not_a_relayed_call_is_never_dropped(self):
        feeds = {"home-a": feed("quota:x"), "home-b": feed()}
        self.assertFalse(self.drop(feeds, "home-a", "quota:x"))


class AnswerAge(unittest.TestCase):
    """The age of the answer behind the calls, on the host's clock, against the source's own limit for it."""

    def state(self, as_of, limit=600):
        c = {"id": "attention", "as_of": as_of, "status": "ok", "stale_after_s": limit}
        return gaps.freshness([c], GEN, RECV, RECV + 30)[0]

    def test_an_old_copy_is_past_the_limit(self):
        f = self.state("2027-01-15T00:00:00Z")   # eight hours before the feed was built
        self.assertEqual((f["state"], f["limit_s"]), ("old", 600))
        self.assertGreater(f["age_s"], 28000)

    def test_a_fresh_copy_is_inside_it(self):
        f = self.state("2027-01-15T07:59:30Z")
        self.assertEqual(f["state"], "ok")
        self.assertLess(f["age_s"], 600)

    def test_no_limit_says_no_state_it_cannot_judge(self):
        c = {"id": "attention", "as_of": "2027-01-15T00:00:00Z", "status": "ok"}
        self.assertIsNone(gaps.freshness([c], GEN, RECV, RECV + 30)[0]["limit_s"])


class FeedContract(unittest.TestCase):
    def doc(self, **card):
        return {"schema": "lookout.feed", "schema_version": "1.8", "source": {"id": "src"}, "items": [],
                "attention": [dict({"id": "c", "kind": "decision", "severity": "action", "title": "A call"}, **card)]}

    def test_the_field_is_optional_and_read(self):
        clean, warn = schema.validate(self.doc(as_of="2027-01-15T07:59:00Z"))
        self.assertEqual(clean["attention"][0]["as_of"], "2027-01-15T07:59:00Z")
        self.assertEqual(warn, [])
        clean, _ = schema.validate(self.doc())
        self.assertIsNone(clean["attention"][0].get("as_of"))


if __name__ == "__main__":
    unittest.main()
