"""Contract tests for the parts of the core whose answers are a promise to every source (0.2.0).

    python3 -m unittest discover -s tests

Added as a deliberate, narrow exception to the project's rule against agent-written tests, at the owner's request
(CONTRIBUTING.md, "Tests"). They cover only:
  - the lane taxonomy (src/weatherdeck/lanes.py): which class a work item falls in, from what its source says;
  - the allowance chips (src/weatherdeck/allowance.py): their words, their fixed order, and that a running-out sentence
    comes only from the source's own projection;
  - the feed contract (src/weatherdeck/schema.py): what a 1.0 and a 1.1 feed may carry.
Synthetic data only, standard library only, no network, no clock: every time is passed in.
"""
import json
import sys
import unittest
from datetime import timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import allowance, lanes, schema  # noqa: E402

NOW = 1_800_000_000          # 2027-01-15T08:00:00Z, a fixed clock
UTC = timezone.utc


def item(**kw):
    base = {"id": "x", "title": "A task", "state": "running"}
    base.update(kw)
    return base


def pr(state):
    return {"url": "https://forge.example/team/app/pull/7", "label": "#7", "state": state}


class Taxonomy(unittest.TestCase):
    """Off course is needs_action plus running_long, nothing else; waiting is never an alarm; mapped from the source."""

    CASES = [
        # (what the source says, kind, class, waiting_on)
        (item(), "moving", "ok", None),
        (item(kind="scout"), "scout", "ok", None),
        (item(progress={"regressed": True, "current": {"round": 2}}), "regressed", "ok", None),
        (item(flags=["running_long"]), "long", "running_long", None),
        (item(progress={"current": {"elapsed_s": 700, "p90_s": 600}}), "long", "running_long", None),
        (item(state="failed"), "failed", "needs_action", None),
        (item(state="blocked"), "blocked", "needs_action", None),
        (item(state="waiting", needs_you=True), "call", "needs_action", None),
        (item(state="waiting"), "mate", "waiting", None),
        (item(state="paused", waiting_on="gate", until="2027-01-15T12:00:00Z"), "mate", "waiting", "gate"),
        (item(state="paused", waiting_on="capacity"), "mate", "waiting", "capacity"),
        (item(state="waiting", waiting_on="quiet_hours"), "mate", "waiting", "quiet_hours"),
        (item(state="paused", waiting_on="somewhere-else"), "mate", "waiting", None),
        (item(state="failed", link=pr("open")), "pr_open", "waiting", "pr"),
        (item(state="done", link=pr("open")), "pr_open", "waiting", "pr"),
        (item(state="failed", link=pr(None)), "pr_unread", "waiting", "pr"),
        (item(state="failed", link=pr("closed")), "failed", "needs_action", None),
        (item(state="done", link=pr("merged")), "done", "ok", None),
        (item(state="running", link=pr("closed")), "moving", "ok", None),
        (item(state="done"), "done", "ok", None),
        (item(state="done", handoff={"state": "awaiting_you"}), "approval", "waiting", "human"),
        (item(state="done", handoff={"state": "awaiting_you"}, link=pr("open")), "approval", "waiting", "pr"),
        (item(state="done", handoff={"state": "awaiting_you"}, needs_you=True), "approval", "needs_action", None),
        (item(state="unknown"), "unknown", "quiet", None),
        (item(state=None), "unknown", "quiet", None),
        (item(state="frobbing"), "unknown", "quiet", None),
        (item(waiting_on="gate"), "moving", "ok", None),
    ]

    def test_each_case(self):
        for it, kind, cls, on in self.CASES:
            with self.subTest(it=it):
                got = lanes.classify(it)
                self.assertEqual((got["kind"], got["cls"], got["waiting_on"]), (kind, cls, on))

    def test_off_course_is_two_classes(self):
        self.assertEqual(set(lanes.OFF_COURSE), {"needs_action", "running_long"})
        self.assertEqual(set(lanes.CLASSES), {"needs_action", "running_long", "waiting", "quiet", "ok"})

    def test_until_only_while_waiting(self):
        self.assertEqual(lanes.classify(item(state="paused", until="2027-01-16"))["until"], "2027-01-16")
        self.assertIsNone(lanes.classify(item(state="running", until="2027-01-16"))["until"])

    def test_a_step_clock_that_ran_on_crosses_p90(self):
        it = item(progress={"current": {"elapsed_s": 550, "p90_s": 600}})
        self.assertEqual(lanes.classify(it)["cls"], "ok")
        self.assertEqual(lanes.classify(it, grown_s=60)["cls"], "running_long")

    def test_a_merged_pr_is_never_agent_gone_whatever_the_state(self):
        # Readability slice 3: a lane paused (or still marked running, waiting or blocked) after its PR merged, whose worker's
        # session then ended, is an old record, not trouble. Only a merged PR is exempt: a closed one still needs action.
        ended = {"state": "ended", "since": "2027-01-14T08:00:00Z"}
        for state in ("paused", "running", "waiting", "blocked", "unknown"):
            for agent in (ended, dict(ended, state="gone")):
                with self.subTest(state=state, agent=agent["state"]):
                    it = item(state=state, link=pr("merged"), agent=agent)
                    self.assertIsNone(lanes.agent_gone(it, NOW, 600))
                    self.assertNotEqual(lanes.classify(it, now=NOW)["kind"], "agent_gone")
        lane = lanes.classify(item(state="paused", link=pr("merged"), agent=ended), now=NOW)
        self.assertNotIn(lane["cls"], lanes.OFF_COURSE)
        self.assertEqual(lanes.classify(item(state="paused", link=pr("closed"), agent=ended), now=NOW)["kind"], "agent_gone")
        self.assertEqual(lanes.classify(item(state="paused", agent=ended), now=NOW)["kind"], "agent_gone")


class RowText(unittest.TestCase):
    def test_project_prefix_moves_into_the_chip(self):
        for title, project, want in [
            ("Harbor: fix the login loop", "Harbor", "fix the login loop"),
            ("harbor-app - fix the login loop", "Harbor App", "fix the login loop"),
            ("[Harbor] fix the login loop", "harbor", "fix the login loop"),
            ("HB fix the login loop", "HB", "fix the login loop"),
            ("Harbors and docks", "Harbor", "Harbors and docks"),
            ("Harbor", "Harbor", "Harbor"),
            ("Fix the login loop", "Harbor", "Fix the login loop"),
        ]:
            with self.subTest(title=title):
                self.assertEqual(lanes.strip_prefix(title, project), want)

    def test_row(self):
        r = lanes.row(item(title="Harbor: fix it", project="Harbor", summary="tests  running\n now", doing="raw [at=1] text"))
        self.assertEqual(r, {"chip": "Harbor", "title": "fix it", "summary": "tests running now"})
        r = lanes.row(item(title="harbor-app: fix it", group="harbor-app", doing="writing tests"), group_label="harbor-app")
        self.assertEqual(r, {"chip": "harbor-app", "title": "fix it", "summary": "writing tests"})
        r = lanes.row(item(state="blocked", doing="started", state_detail="needs a key"))
        self.assertEqual(r["summary"], "needs a key")

    def test_cut_at_a_word(self):
        self.assertEqual(lanes.cut_words("one two three four", 12), "one two…")
        self.assertEqual(lanes.cut_words("short", 12), "short")
        self.assertEqual(lanes.cut_words("abcdefghijklmnop", 8), "abcdefg…")


def account(aid, provider, acct, pct, resets="2027-01-15T14:00:00Z", runway=None, label=None):
    return {"id": aid, "provider": provider, "account": acct, "label": label,
            "windows": [{"id": "seven_day", "label": "Week", "percent_remaining": pct, "resets_at": resets},
                        {"id": "five_hour", "label": "5-hour", "percent_remaining": 90, "resets_at": "2027-01-15T10:00:00Z"}],
            "runway": runway or {"status": "through_reset"}}


class AllowanceChips(unittest.TestCase):
    def test_words_of_a_chip(self):
        c = allowance.chip(account("a1", "Orbit", "Team", 34), NOW, UTC)
        self.assertEqual((c["provider"], c["account"], c["window"]["short"], c["left"], c["resets"]), ("Orbit", "Team", "wk", 34, "14:00"))
        self.assertEqual(c["forms"][0], "Orbit Team wk 34% 14:00")
        self.assertEqual(c["state"], "ok")
        self.assertIsNone(c["sentence"])

    def test_fixed_order_never_follows_the_numbers(self):
        a = [account("z", "Orbit", "Zeta", 5), account("b", "Beacon", "Main", 90), account("a", "Orbit", "Alpha", 60)]
        order = [c["id"] for c in allowance.chips(a, NOW, UTC)]
        self.assertEqual(order, ["b", "a", "z"])
        a[0]["windows"][0]["percent_remaining"] = 95
        self.assertEqual([c["id"] for c in allowance.chips(a, NOW, UTC)], order)

    def test_only_listed_providers(self):
        a = [account("a", "Orbit", "Team", 50), account("b", "Beacon", "Main", 50)]
        self.assertEqual([c["id"] for c in allowance.chips(a, NOW, UTC, providers=["orbit"])], ["a"])
        self.assertEqual(len(allowance.chips(a, NOW, UTC, providers=[])), 2)

    def test_running_out_comes_only_from_the_projection(self):
        low = allowance.chip(account("a", "Orbit", "Team", 3), NOW, UTC)
        self.assertEqual(low["state"], "out")
        self.assertIsNone(low["sentence"])   # a low number alone never makes a projection
        proj = allowance.chip(account("a", "Orbit", "Team", 40, runway={"status": "exhausts_before_reset",
                                                                         "projected_empty_at": "2027-01-15T12:30:00Z"}), NOW, UTC)
        self.assertEqual(proj["state"], "low")
        self.assertEqual(proj["sentence"], "Orbit (Team) may run out in 4 h 30 min (12:30), before the Week reset 14:00")
        out = allowance.chip(account("a", "Orbit", "Team", 0, runway={"status": "exhausted"}), NOW, UTC)
        self.assertEqual(out["sentence"], "Orbit (Team) is out until the Week reset 14:00")

    def test_each_sentence_names_its_own_account(self):
        a = [account("a", "Orbit", "One", 40, runway={"status": "exhausts_before_reset", "projected_empty_at": "2027-01-15T12:00:00Z"}),
             account("b", "Orbit", "Two", 40, runway={"status": "exhausts_before_reset", "projected_empty_at": "2027-01-15T13:00:00Z"})]
        said = {c["id"]: c["sentence"] for c in allowance.chips(a, NOW, UTC)}
        self.assertIn("(One)", said["a"])
        self.assertIn("(Two)", said["b"])

    def test_unreadable_and_old_labels(self):
        c = allowance.chip({"id": "a", "label": "Orbit, Team", "windows": []}, NOW, UTC)
        self.assertEqual((c["provider"], c["account"], c["state"]), ("Orbit", "Team", "unavailable"))
        self.assertEqual(c["forms"][0], "Orbit Team unavailable")

    def test_reset_words(self):
        self.assertEqual(allowance.when(NOW + 3600, UTC, NOW), "09:00")
        self.assertEqual(allowance.when(NOW + 2 * 86400, UTC, NOW), "Sun 08:00")
        self.assertEqual(allowance.when(NOW + 20 * 86400, UTC, NOW), "4 Feb")


class FeedContract(unittest.TestCase):
    def feed(self, version="1.1", **items):
        return {"schema": "lookout.feed", "schema_version": version, "source": {"id": "src-a"},
                "items": [dict({"id": "x", "title": "A task", "state": "running"}, **items)]}

    def test_examples_validate(self):
        for path in sorted((ROOT / "examples" / "demo").glob("*-*.json")):
            with self.subTest(path=path.name):
                schema.validate(json.loads(path.read_text()))

    def test_a_1_0_feed_still_validates(self):
        clean, _ = schema.validate(self.feed("1.0"))
        self.assertEqual(clean["items"][0]["state"], "running")

    def test_1_1_item_fields(self):
        clean, _ = schema.validate(self.feed(project="Harbor", summary="tests running", waiting_on="gate", until="2027-01-16"))
        self.assertEqual(clean["items"][0]["waiting_on"], "gate")
        schema.validate(self.feed(until="2027-01-16T09:30:00Z"))
        for bad in ({"summary": 5}, {"project": ["a"]}, {"until": "tomorrow"}, {"until": "2027-13-45T99:00:00Z"}):
            with self.subTest(bad=bad):
                with self.assertRaises(schema.Reject):
                    schema.validate(self.feed(**bad))

    def test_unknown_words_pass_through(self):
        clean, _ = schema.validate(self.feed(waiting_on="a-new-reason", state="frobbing", extra={"anything": 1}))
        self.assertEqual(clean["items"][0]["waiting_on"], "a-new-reason")
        self.assertEqual(clean["items"][0]["extra"], {"anything": 1})

    def test_machine_rest_and_named_accounts(self):
        doc = self.feed()
        doc["machines"] = [{"id": "m1", "health": {"state": "reserved", "reason": "held for a test", "until": "2027-01-15T12:00:00Z"}}]
        doc["meters"] = {"accounts": [{"id": "a", "provider": "Orbit", "account": "Team",
                                       "windows": [{"id": "w", "short": "wk", "percent_remaining": 10}]}]}
        clean, _ = schema.validate(doc)
        self.assertEqual(clean["machines"][0]["health"]["state"], "reserved")
        doc["machines"][0]["health"]["until"] = 12
        with self.assertRaises(schema.Reject):
            schema.validate(doc)

    def test_a_higher_major_is_refused(self):
        with self.assertRaises(schema.Reject) as caught:
            schema.validate(self.feed("2.0"))
        self.assertEqual(caught.exception.kind, "version")


if __name__ == "__main__":
    unittest.main()
