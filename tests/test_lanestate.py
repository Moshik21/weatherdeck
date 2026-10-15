"""Contract tests for a lane's state word and sentence (unreleased, feed 1.5: `items[].lane` and `items[].say`).

    python3 -m unittest discover -s tests

Added under the same deliberate, narrow exception as tests/test_contract.py, which the owner extended to this release
(CONTRIBUTING.md, "Tests"), for pure core logic and the feed contract only: the 1.5 fields in `src/weatherdeck/schema.py` and what
the view keeps and a guest view drops (`src/weatherdeck/view.py`). Synthetic data only, standard library only, no network, no clock:
every time is passed in.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import schema, view  # noqa: E402


class FeedContract(unittest.TestCase):
    def feed(self, **item):
        return {"schema": "lookout.feed", "schema_version": "1.5", "source": {"id": "src"},
                "items": [dict({"id": "a", "title": "A", "state": "running"}, **item)]}

    def test_the_fields_are_optional_and_read(self):
        ln = {"state": "Working", "cause": "worker-busy", "since": "2027-01-15T07:00:00Z",
              "last_word": {"verb": "working", "at": "2027-01-15T07:00:00Z"}, "short_title": "A"}
        clean, warn = schema.validate(self.feed(lane=ln, say=[{"t": "worker-busy"}, {"t": "tests-running", "step": 2, "of": 4}]))
        self.assertEqual(clean["items"][0]["lane"], ln)
        self.assertEqual(warn, [])
        schema.validate(self.feed())

    def test_unknown_slots_and_words_pass_through(self):
        clean, _ = schema.validate(self.feed(lane={"state": "Sideways", "later": 1}, say=[{"t": "future-template", "x": [1]}]))
        self.assertEqual(clean["items"][0]["say"][0]["x"], [1])

    def test_a_wrong_type_is_rejected(self):
        for bad in ({"lane": {"since": "yesterday"}}, {"lane": {"last_word": {"at": 5}}}, {"say": [{"step": 2}]}, {"say": [{"t": "x", "at": "soon"}]},
                    {"say": "Working"}):
            with self.assertRaises(schema.Reject):
                schema.validate(self.feed(**bad))

    def test_a_say_is_at_most_eight_parts(self):
        with self.assertRaises(schema.Reject):
            schema.validate(self.feed(say=[{"t": "x"}] * 9))


class WhatAGuestSees(unittest.TestCase):
    def view(self):
        item = {"id": "a", "title": "Secret job", "source_lane": {"state": "Working", "short_title": "Secret job"},
                "say": [{"t": "starts-when-lands", "title": "Other secret", "more": 1}], "lane": {"cls": "ok"}, "row": {}, "flags": []}
        return {"cards": [], "sources": [], "items": [item], "attention": [], "attention_pending": [], "next": [], "done": [], "groups": [],
                "machines": [], "history": {"timeline": [], "notes": []},
                "gaps": {"waits_outside": [], "oldest_waiting": None, "queues": [], "coming_up": [], "deploys": []}}

    def test_a_guest_loses_the_titles_but_keeps_the_words(self):
        v = self.view()
        view.redact(v, "guest", {})
        it = v["items"][0]
        self.assertIsNone(it["source_lane"]["short_title"])
        self.assertEqual(it["source_lane"]["state"], "Working")
        self.assertEqual(it["say"], [{"t": "starts-when-lands", "more": 1}])
        self.assertEqual(it["lane"], {"cls": "ok"})

    def test_a_household_view_keeps_them(self):
        v = self.view()
        view.redact(v, "household", {})
        self.assertEqual(v["items"][0]["source_lane"]["short_title"], "Secret job")
        self.assertEqual(v["items"][0]["say"][0]["title"], "Other secret")
if __name__ == "__main__":
    unittest.main()

if __name__ == "__main__":
    unittest.main()
