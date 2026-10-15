"""Contract tests for the link from a call that waits on you to the review board (unreleased, feed 1.6: `attention[].answer_link`).

    python3 -m unittest discover -s tests

Added under the same deliberate, narrow exception as tests/test_lanestate.py (CONTRIBUTING.md, "Tests"), for pure core logic and the
feed-spec contract only: the 1.6 field in `src/weatherdeck/schema.py` and what every redacted view drops of it (`src/weatherdeck/view.py`).
Synthetic data only, standard library only, no network, no clock: every time is passed in.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import schema, view  # noqa: E402

URL = "http://host.example.test:4387/session/0123456789abcdef"


class FeedContract(unittest.TestCase):
    def feed(self, **card):
        return {"schema": "lookout.feed", "schema_version": "1.6", "source": {"id": "src"}, "items": [],
                "attention": [dict({"id": "c", "kind": "decision", "severity": "action", "title": "A call"}, **card)]}

    def test_the_field_is_optional_and_read(self):
        al = {"url": URL, "label": "review board", "state": "open", "state_as_of": "2027-01-15T07:59:00Z", "why": None}
        clean, warn = schema.validate(self.feed(answer_link=al))
        self.assertEqual(clean["attention"][0]["answer_link"]["url"], URL)
        self.assertEqual(warn, [])
        schema.validate(self.feed())

    def test_a_link_that_is_not_http_is_dropped(self):
        clean, warn = schema.validate(self.feed(answer_link={"url": "javascript:alert(1)", "state": "open"}))
        self.assertIsNone(clean["attention"][0]["answer_link"]["url"])
        self.assertTrue(warn)

    def test_a_wrong_type_is_rejected(self):
        for bad in ({"state_as_of": "yesterday"}, {"why": 5}, {"state": ["open"]}):
            with self.assertRaises(schema.Reject):
                schema.validate(self.feed(answer_link=bad))


class WhatEachProfileSees(unittest.TestCase):
    def view(self):
        card = {"id": "c", "kind": "decision", "title": "A call", "detail": "why", "how": "answer in chat", "link": None, "item": None,
                "recommend": "yes", "say": "a: yes", "answer_link": {"url": URL, "label": "review board", "state": "open", "state_as_of": None, "why": None}}
        return {"cards": [], "sources": [], "items": [], "attention": [card], "attention_pending": [], "next": [], "done": [], "groups": [],
                "machines": [], "history": {"timeline": [], "notes": []},
                "gaps": {"waits_outside": [], "oldest_waiting": None, "queues": [], "coming_up": [], "deploys": []}}

    def test_the_full_view_keeps_the_address(self):
        v = self.view()
        self.assertEqual(v["attention"][0]["answer_link"]["url"], URL)

    def test_the_television_the_guest_and_the_public_views_never_carry_it(self):
        for level in ("household", "guest", "public"):
            v = self.view()
            view.redact(v, level, {})
            self.assertIsNone(v["attention"][0]["answer_link"], level)
if __name__ == "__main__":
    unittest.main()

if __name__ == "__main__":
    unittest.main()
