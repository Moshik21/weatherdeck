"""Contract tests for the machine-alert debounce (src/weatherdeck/debounce.py): two feeds to raise, two to clear.

Added with the debounce under the owner's narrow exception (CONTRIBUTING.md): pure core logic, synthetic data, standard
library, no network.
"""
import unittest

from weatherdeck import debounce


def card(cid="disk:box:c", kind="disk", severity="info"):
    return {"id": cid, "kind": kind, "severity": severity, "machine": "box"}


def run(feeds):
    """Fold a list of feeds (a card or None each) and return [(state, phase)] after each."""
    st, out = None, []
    for c in feeds:
        st = debounce.step(st, c)
        out.append(debounce.split(st, c)[0] if st or c else None)
    return out


class Which(unittest.TestCase):
    def test_machine_and_disk_cards_are_debounced(self):
        self.assertTrue(debounce.is_machine_alert(card()))
        self.assertTrue(debounce.is_machine_alert(card("home:x:unreadable", "machine", "action")))

    def test_criticals_and_services_never_are(self):
        self.assertFalse(debounce.is_machine_alert(card(severity="critical")))
        self.assertFalse(debounce.is_machine_alert(card("service:supervision:s", "service", "critical")))
        self.assertFalse(debounce.is_machine_alert(card("service:supervision:s", "service", "info")))
        self.assertFalse(debounce.is_machine_alert(card("service:supervision:s", "machine", "info")))
        self.assertFalse(debounce.is_machine_alert(card("host:box:lost", "machine", "info")))
        self.assertFalse(debounce.is_machine_alert(card("pick", "decision", "action")))
        self.assertFalse(debounce.is_machine_alert(None))


class Steps(unittest.TestCase):
    def test_two_feeds_to_raise(self):
        self.assertEqual(run([card(), card()]), ["raising", "raised"])

    def test_one_feed_never_raises_and_is_forgotten(self):
        self.assertEqual(run([card(), None, None]), ["raising", None, None])

    def test_two_feeds_to_clear(self):
        self.assertEqual(run([card(), card(), None, None]), ["raising", "raised", "clearing", None])

    def test_a_raised_alert_that_returns_stays_raised(self):
        self.assertEqual(run([card(), card(), None, card()]), ["raising", "raised", "clearing", "raised"])

    def test_the_held_card_is_the_last_one_sent(self):
        st = debounce.step(debounce.step(None, card()), card())
        st = debounce.step(st, None)
        self.assertEqual(debounce.split(st, None), ("clearing", card()))

    def test_nothing_held_for_an_alert_never_raised(self):
        self.assertEqual(debounce.split(debounce.step(None, card()), None), (None, None))


if __name__ == "__main__":
    unittest.main()
