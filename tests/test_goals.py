"""Contract tests for goals (unreleased, feed 1.7: `goal` on items, next and done, and the top-level `goals[]`).

    python3 -m unittest discover -s tests

Added under the same deliberate, narrow exception as tests/test_contract.py, which the owner extended to this release
(CONTRIBUTING.md, "Tests"), for pure core logic and the feed contract only: the 1.7 fields in `src/weatherdeck/schema.py`, the
view's goal headers (`src/weatherdeck/goals.py`) and what a guest view drops (`src/weatherdeck/view.py`). Synthetic data only,
standard library only, no network, no clock.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import goals, schema, view  # noqa: E402


class FeedContract(unittest.TestCase):
    def feed(self, **top):
        doc = {"schema": "lookout.feed", "schema_version": "1.7", "source": {"id": "src"},
               "items": [{"id": "a", "title": "A", "state": "running", "goal": "G"}],
               "next": [{"id": "n", "goal": "G"}], "done": [{"id": "d", "at": "2027-01-15T07:00:00Z", "goal": "G"}],
               "goals": [{"name": "G", "lanes": 1, "next": 1, "done": 1, "or_more": ["done"]}]}
        doc.update(top)
        return doc

    def test_the_fields_are_optional_and_read(self):
        clean, warn = schema.validate(self.feed())
        self.assertEqual((clean["items"][0]["goal"], clean["next"][0]["goal"], clean["done"][0]["goal"]), ("G", "G", "G"))
        self.assertEqual(clean["goals"][0]["or_more"], ["done"])
        self.assertEqual(warn, [])
        clean, _ = schema.validate({"schema": "lookout.feed", "schema_version": "1.5", "source": {"id": "src"}})
        self.assertEqual(clean["goals"], [])

    def test_a_wrong_type_is_rejected(self):
        for bad in ({"goals": [{"lanes": 1}]}, {"goals": [{"name": "G", "lanes": "two"}]}, {"goals": [{"name": "G", "or_more": "done"}]},
                    {"goals": "G"}, {"items": [{"id": "a", "goal": 5}]}, {"next": [{"id": "n", "goal": ["G"]}]}):
            with self.assertRaises(schema.Reject):
                schema.validate(self.feed(**bad))

    def test_at_most_twenty_goals(self):
        schema.validate(self.feed(goals=[{"name": "G%d" % n} for n in range(20)]))
        with self.assertRaises(schema.Reject):
            schema.validate(self.feed(goals=[{"name": "G%d" % n} for n in range(21)]))


class TheViewsHeaders(unittest.TestCase):
    def test_counted_over_the_merged_rows_in_the_order_sources_name_them(self):
        declared = [[{"name": "B", "or_more": ["done"]}, {"name": "A"}], [{"name": "A", "or_more": ["next", "bogus"]}, {"name": "C"}]]
        items = [{"goal": "A"}, {"goal": "A"}, {"goal": "B"}, {}]
        h = goals.headers(declared, items, [{"goal": "A"}], [{"goal": "B"}])
        self.assertEqual(h, [{"name": "B", "lanes": 1, "next": 0, "done": 1, "or_more": ["done"]},
                             {"name": "A", "lanes": 2, "next": 1, "done": 0, "or_more": ["next"]}])

    def test_a_declared_goal_no_carried_row_carries_has_no_header(self):
        self.assertEqual(goals.headers([[{"name": "C", "lanes": 2, "or_more": ["lanes"]}]], [{}], [], []), [])

    def test_a_cut_done_list_makes_every_done_count_or_more(self):
        h = goals.headers([[{"name": "A"}]], [{"goal": "A"}], [], [{"goal": "B"}], True)
        self.assertEqual(h, [{"name": "A", "lanes": 1, "next": 0, "done": 0, "or_more": ["done"]},
                             {"name": "B", "lanes": 0, "next": 0, "done": 1, "or_more": ["done"]}])
        self.assertEqual(goals.headers([], [], [], [{"goal": "B"}])[0]["or_more"], [])

    def test_a_goal_only_a_row_names_still_has_a_header(self):
        self.assertEqual(goals.headers([], [{"goal": "Z"}], [], []), [{"name": "Z", "lanes": 1, "next": 0, "done": 0, "or_more": []}])

    def test_no_goals_is_no_headers_and_a_bad_declaration_is_skipped(self):
        self.assertEqual(goals.headers([], [{}], [{}], [{}]), [])
        self.assertEqual(goals.headers([None, "x", [None, {"name": 3}, {"name": ""}]], [], [], []), [])

    def test_a_goal_in_the_declaration_only_counts_what_the_merged_view_holds(self):
        # a source says 5 lanes; two of them are second-hand copies the view dropped: the header says what the board shows
        self.assertEqual(goals.headers([[{"name": "A", "lanes": 5}]], [{"goal": "A"}] * 3, [], [])[0]["lanes"], 3)


class WhatAGuestSees(unittest.TestCase):
    def view(self):
        item = {"id": "a", "title": "Secret job", "goal": "Secret goal", "lane": {"cls": "ok"}, "row": {}, "flags": []}
        return {"cards": [], "sources": [], "items": [item], "attention": [], "attention_pending": [],
                "next": [{"id": "n", "goal": "Secret goal"}], "done": [{"id": "d", "goal": "Secret goal"}], "groups": [], "machines": [],
                "goals": [{"name": "Secret goal", "lanes": 1, "next": 1, "done": 1, "or_more": []}], "history": {"timeline": [], "notes": []},
                "gaps": {"waits_outside": [], "oldest_waiting": None, "queues": [], "coming_up": [], "deploys": []}}

    def test_a_guest_and_the_public_lose_the_goals(self):
        for level in ("guest", "public"):
            v = self.view()
            view.redact(v, level, {})
            self.assertEqual(v["goals"], [])
            self.assertNotIn("goal", v["items"][0])
            self.assertTrue(all("goal" not in r for r in v["next"] + v["done"]))

    def test_a_household_view_keeps_them(self):
        v = self.view()
        view.redact(v, "household", {})
        self.assertEqual(v["goals"][0]["name"], "Secret goal")
        self.assertEqual(v["items"][0]["goal"], "Secret goal")
if __name__ == "__main__":
    unittest.main()

if __name__ == "__main__":
    unittest.main()
