"""Contract tests for the version gap rule and the 1.3 producer fields (src/weatherdeck/skew.py, schema.py).

Added in 0.5.0 under the owner's narrow exception (CONTRIBUTING.md): pure core logic and the feed-spec contract, synthetic
data, standard library, no network.
"""
import unittest

from weatherdeck import schema, skew

MEANING = [{"since": "1.7", "effect": "it sends no agent state"}, {"since": "1.10", "effect": "a missing meter reads as failed"}]


def entry(source, version, name="adapter-x", meaning=None):
    return {"source": source, "name": name, "version": version, "meaning": meaning or []}


class Parse(unittest.TestCase):
    def test_dotted_numbers_only(self):
        self.assertEqual(skew.parse("1.10"), (1, 10))
        self.assertEqual(skew.parse("v2"), (2,))
        for bad in (None, "", "1.x", "latest", "1..2", 3):
            self.assertIsNone(skew.parse(bad))

    def test_producer_of_says_nothing_it_was_not_told(self):
        p = skew.producer_of({})
        self.assertEqual((p["name"], p["version"], p["pusher"], p["host"], p["meaning"]), (None, None, None, None, []))
        p = skew.producer_of({"producer": {"name": "a", "version": "1.2", "meaning": [{"since": "x", "effect": "no"}, {"since": "1.1"}, {"since": "1.1", "effect": "ok"}]}})
        self.assertEqual(p["meaning"], [{"since": "1.1", "effect": "ok"}])


class Assess(unittest.TestCase):
    def test_older_than_a_change_a_peer_has_is_flagged_with_the_reason(self):
        out = skew.assess([entry("old", "1.6"), entry("new", "1.10", meaning=MEANING)])
        self.assertEqual([n["since"] for n in out["old"]], ["1.7", "1.10"])
        self.assertEqual(out["old"][0]["effect"], "it sends no agent state")
        self.assertEqual((out["old"][0]["newer_source"], out["old"][0]["newer_version"]), ("new", "1.10"))
        self.assertEqual(out["new"], [])

    def test_a_difference_with_no_change_between_is_not_a_gap(self):
        out = skew.assess([entry("a", "1.8"), entry("b", "1.9", meaning=MEANING)])
        self.assertEqual(out["a"], [])

    def test_numbers_compare_as_numbers(self):
        out = skew.assess([entry("a", "1.9"), entry("b", "1.10", meaning=MEANING)])
        self.assertEqual([n["since"] for n in out["a"]], ["1.10"])

    def test_unknown_version_is_never_flagged_and_never_the_newer_side(self):
        out = skew.assess([entry("quiet", None), entry("odd", "nightly"), entry("old", "1.6"), entry("new", "1.9", meaning=MEANING)])
        self.assertEqual(out["quiet"], [])
        self.assertEqual(out["odd"], [])
        self.assertEqual([n["since"] for n in out["old"]], ["1.7"])
        self.assertEqual(skew.assess([entry("quiet", None, meaning=MEANING), entry("old", "1.6")])["old"], [])

    def test_only_the_same_producer_is_compared(self):
        out = skew.assess([entry("a", "1.0", name="one"), entry("b", "2.0", name="two", meaning=MEANING)])
        self.assertEqual(out["a"], [])

    def test_no_source_without_a_name_is_compared(self):
        self.assertEqual(skew.assess([entry("a", "1.0", name=None), entry("b", "2.0", name=None, meaning=MEANING)])["a"], [])

    def test_a_trailing_zero_is_the_same_version(self):
        out = skew.assess([entry("a", "1.7.0"), entry("b", "1.7", meaning=MEANING)])
        self.assertEqual(out["a"], [])


class Feed13(unittest.TestCase):
    def doc(self, producer):
        return {"schema": "lookout.feed", "schema_version": "1.3", "source": {"id": "s1"}, "producer": producer}

    def test_producer_fields_pass_and_are_optional(self):
        clean, _ = schema.validate(self.doc({"name": "a", "version": "1.1", "host": "box", "pusher": {"name": "p", "version": "2"},
                                             "meaning": [{"since": "1.0", "effect": "x"}]}))
        self.assertEqual(clean["producer"]["pusher"]["version"], "2")
        clean, _ = schema.validate(self.doc({"name": "a"}))
        self.assertNotIn("version", clean["producer"])

    def test_wrong_types_are_rejected(self):
        for bad in ({"host": 3}, {"pusher": {"version": 2}}, {"meaning": [{"since": 1}]}):
            with self.assertRaises(schema.Reject):
                schema.validate(self.doc(bad))

    def test_meaning_is_capped(self):
        with self.assertRaises(schema.Reject):
            schema.validate(self.doc({"meaning": [{"since": "1.0", "effect": "x"}] * 13}))


if __name__ == "__main__":
    unittest.main()
