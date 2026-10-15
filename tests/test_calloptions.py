"""Contract tests for the choices of a call (unreleased, feed 1.9: `attention[].options`).

    python3 -m unittest discover -s tests

Added under the same deliberate, narrow exception as tests/test_stalecalls.py (CONTRIBUTING.md, "Tests"), for pure core logic and the
feed-spec contract only: the 1.9 `options` field in `src/weatherdeck/schema.py` and that the television, guest and public views drop it
(`src/weatherdeck/view.py`). Synthetic data only, standard library only, no network, no clock.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import schema, view  # noqa: E402


class CallOptions(unittest.TestCase):
    def test_the_field_is_in_the_schema_and_a_feed_with_it_is_accepted(self):
        self.assertIn("options", schema.ATTENTION)

    def test_the_television_the_guest_and_the_public_views_drop_it(self):
        for level in ("household", "guest", "public"):
            v = {"cards": [], "sources": [], "items": [], "attention_pending": [], "next": [], "done": [], "groups": [], "machines": [],
                 "history": {"timeline": [], "notes": []},
                 "gaps": {"waits_outside": [], "oldest_waiting": None, "queues": [], "coming_up": [], "deploys": []},
                 "attention": [{"id": "c", "kind": "decision", "title": "A call", "options": ["A", "B"]}]}
            view.redact(v, level, {})
            self.assertNotIn("options", v["attention"][0], level)


if __name__ == "__main__":
    unittest.main()
