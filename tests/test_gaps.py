"""Contract tests for what the board says about work that waits where nobody looks (0.3.0, feed 1.2).

    python3 -m unittest discover -s tests

Added under the same deliberate, narrow exception as tests/test_contract.py, which the owner extended to this release
(CONTRIBUTING.md, "Tests"). They cover only pure core logic and the feed contract:
  - the agent rule (src/weatherdeck/lanes.py): an ended or gone agent needs action after the configured minutes, never quiet;
  - age in state, outside waits, queues, coming up, the shipping gap, collector freshness and relative time
    (src/weatherdeck/gaps.py);
  - the burn-rate countdown (src/weatherdeck/allowance.py), from the source's own projection only;
  - the 1.2 feed contract (src/weatherdeck/schema.py).
Synthetic data only, standard library only, no network, no clock: every time is passed in.
"""
import sys
import unittest
from datetime import timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import allowance, gaps, lanes, schema  # noqa: E402

NOW = 1_800_000_000          # 2027-01-15T08:00:00Z, a fixed clock
UTC = timezone.utc


def iso(t):
    import time
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def item(**kw):
    base = {"id": "x", "title": "A task", "state": "running"}
    base.update(kw)
    return base


def classed(it, now=NOW, after_s=600):
    out = dict(it)
    out["lane"] = lanes.classify(out, 0.0, now, after_s)
    out["row"] = lanes.row(out)
    return out


class AgentRule(unittest.TestCase):
    """Nobody at the work needs action after the configured minutes; silence and idleness never do."""

    def test_ended_or_gone_past_the_minutes_needs_action(self):
        for state in ("ended", "gone"):
            for work in ("running", "waiting", "paused", "unknown"):
                lane = lanes.classify(item(state=work, agent={"state": state, "since": iso(NOW - 900)}), 0.0, NOW, 600)
                self.assertEqual((lane["kind"], lane["cls"]), ("agent_gone", "needs_action"), (state, work))
                self.assertEqual(lane["agent_gone_s"], 900)

    def test_not_before_the_minutes(self):
        lane = lanes.classify(item(agent={"state": "ended", "since": iso(NOW - 300)}), 0.0, NOW, 600)
        self.assertEqual(lane["cls"], "ok")

    def test_alive_idle_unknown_or_missing_never_flag(self):
        old = iso(NOW - 86400)
        for agent in ({"state": "alive", "since": old}, {"state": "unknown", "since": old}, {"state": "idle", "since": old},
                      {"state": "ended"}, None):
            it = item(progress={"current": {"activity": "quiet", "last_activity_age_s": 7200}})
            if agent is not None:
                it["agent"] = agent
            self.assertNotEqual(lanes.classify(it, 0.0, NOW, 600)["kind"], "agent_gone", agent)

    def test_finished_work_needs_no_agent(self):
        gone = {"state": "gone", "since": iso(NOW - 3600)}
        pr = {"url": "https://forge.example/team/app/pull/7", "state": "open"}
        for it in (item(state="done", agent=gone), item(state="failed", agent=gone), item(state="failed", link=pr, agent=gone),
                   item(state="done", link=dict(pr, state="merged"), agent=gone)):
            self.assertNotEqual(lanes.classify(it, 0.0, NOW, 600)["kind"], "agent_gone")

    def test_without_a_clock_the_rule_is_off(self):
        self.assertEqual(lanes.classify(item(agent={"state": "gone", "since": iso(NOW - 3600)}))["cls"], "ok")


class AgeInState(unittest.TestCase):
    def test_bases_in_order(self):
        cases = [
            (item(state_since=iso(NOW - 100), started_at=iso(NOW - 900)), 100, "state_since"),
            (item(state="paused", waiting_since=iso(NOW - 200)), 200, "waiting_since"),
            (item(state="done", handoff={"state": "awaiting_you", "since": iso(NOW - 300)}), 300, "handoff"),
            (item(progress={"current": {"waiting_since": iso(NOW - 400)}}), 400, "step_waiting"),
            (item(state="blocked", last_event={"state": "blocked", "at": iso(NOW - 500)}), 500, "last_event"),
            (item(started_at=iso(NOW - 600)), 600, "started_at"),
        ]
        for it, s, basis in cases:
            a = gaps.age_in_state(it, NOW)
            self.assertEqual((a["s"], a["basis"]), (s, basis))

    def test_no_guess(self):
        self.assertIsNone(gaps.age_in_state(item(state="waiting"), NOW))
        self.assertIsNone(gaps.age_in_state(item(state="waiting", last_event={"state": "running", "at": iso(NOW - 50)}), NOW))
        self.assertIsNone(gaps.age_in_state(item(state_since=iso(NOW + 3600)), NOW))   # a time in the future is not an age

    def test_oldest_waiting(self):
        its = [classed(item(id="a", state="waiting", waiting_since=iso(NOW - 60))),
               classed(item(id="b", state="blocked", state_since=iso(NOW - 7200))),
               classed(item(id="c", state_since=iso(NOW - 99999)))]   # running: not waiting
        self.assertEqual(gaps.oldest_waiting(its, NOW)["id"], "b")


class OutsideWaits(unittest.TestCase):
    def test_who_and_how_long_oldest_first(self):
        its = [classed(item(id="new", state="waiting", waiting_on="external", waiting_for="a reviewer", waiting_since=iso(NOW - 600))),
               classed(item(id="old", state="paused", waiting_on="external", waiting_for="upstream maintainer",
                            waiting_since=iso(NOW - 172800))),
               classed(item(id="pr", state="done", link={"url": "https://forge.example/team/app/pull/7", "state": "open"})),
               classed(item(id="gate", state="paused", waiting_on="gate", waiting_since=iso(NOW - 999999))),
               classed(item(id="busy", waiting_on="external"))]
        out = gaps.waits_outside(its, NOW)
        self.assertEqual([w["id"] for w in out], ["old", "new", "pr"])
        self.assertEqual((out[0]["who"], out[0]["age_s"]), ("upstream maintainer", 172800))
        self.assertEqual((out[2]["who"], out[2]["age_s"]), (gaps.WAIT_WORDS["pr"], None))

    def test_external_is_a_waiting_word(self):
        lane = lanes.classify(item(state="waiting", waiting_on="external"), 0.0, NOW)
        self.assertEqual((lane["cls"], lane["waiting_on"]), ("waiting", "external"))


class Queues(unittest.TestCase):
    def test_states_order_and_the_host_clock(self):
        rows = [({"id": "floor", "label": "Test floor", "machine": "m1", "length": 3, "oldest_wait_s": 2000, "held": 2, "cap": 2,
                  "holders": [{"label": "a", "since": iso(NOW - 120)}]}, "s1", NOW - 10),
                ({"id": "build", "label": "Build", "machine": "m1", "length": 0, "held": 1, "cap": 2}, "s1", NOW - 10),
                ({"id": "device", "label": "Device lab", "machine": "m1", "length": 1, "oldest_wait_s": 60}, "s1", NOW - 10),
                ({"id": "odd", "label": "Odd", "machine": "m0"}, "s2", NOW)]
        out = gaps.queues(rows, NOW, slow_s=1800)
        self.assertEqual([q["id"] for q in out], ["odd", "build", "device", "floor"])   # machine, then label: never by length
        by = {q["id"]: q for q in out}
        self.assertEqual(by["floor"]["state"], "backed_up")
        self.assertEqual(by["floor"]["oldest_wait_s"], 2010)        # the source's delta plus the time since the host got it
        self.assertEqual(by["floor"]["oldest_since"], NOW - 2010)
        self.assertEqual(by["floor"]["holders"][0]["s"], 120)
        self.assertEqual((by["device"]["state"], by["build"]["state"], by["odd"]["state"]), ("moving", "clear", "unknown"))
        self.assertIsNone(by["build"]["oldest_wait_s"])


class ComingUp(unittest.TestCase):
    def test_dated_holds_and_rests_soonest_first(self):
        its = [classed(item(id="held", state="paused", waiting_on="gate", until=iso(NOW + 3600), title="Held lane")),
               classed(item(id="past", state="paused", until=iso(NOW - 60))),
               classed(item(id="running", until=iso(NOW + 60)))]          # until is read only while held
        nxt = [{"id": "n1", "title": "Queued work", "until": "2027-01-17"}, {"id": "far", "until": "2027-03-01"},
               {"id": "today", "title": "Today's", "until": "2027-01-15"}]
        machines = [{"id": "m1", "label": "Lab box", "health": {"state": "reserved", "until": iso(NOW + 7200), "source": "s1"}},
                    {"id": "m2", "label": "Other", "health": {"state": "ok", "until": iso(NOW + 60)}}]
        out = gaps.coming_up(nxt, its, machines, NOW, UTC, days=7)
        self.assertEqual([(c["kind"], c["id"]) for c in out], [("next", "today"), ("item", "held"), ("machine", "m1"), ("next", "n1")])
        today = out[0]
        self.assertEqual((today["date_only"], today["date"], today["word"]), (True, "2027-01-15", "held_until"))
        self.assertEqual(out[2]["word"], "reserved_ends")


class ShippingGap(unittest.TestCase):
    def test_behind_current_unknown(self):
        rows = [({"id": "web", "label": "Web", "behind": 4, "oldest_unshipped_at": iso(NOW - 86400),
                  "deployed": {"version": "aaa"}, "head": {"version": "bbb"}}, "s1"),
                ({"id": "api", "label": "API", "behind": 0, "deployed": {"version": "ccc"}, "head": {"version": "ccc"}}, "s1"),
                ({"id": "docs", "label": "Docs", "error": "the deployed version cannot be read"}, "s1")]
        out = {d["id"]: d for d in gaps.deploy_gaps(rows, NOW)}
        self.assertEqual((out["web"]["state"], out["web"]["behind"], out["web"]["oldest_s"]), ("behind", 4, 86400))
        self.assertEqual((out["api"]["state"], out["api"]["oldest_s"]), ("current", None))
        self.assertEqual((out["docs"]["state"], out["docs"]["behind"]), ("unknown", None))
        self.assertEqual([d["id"] for d in gaps.deploy_gaps(rows, NOW)], ["api", "docs", "web"])


class Freshness(unittest.TestCase):
    def test_age_on_one_clock_and_limits(self):
        gen = iso(NOW - 30)
        cols = [{"id": "attention", "label": "Tracker", "as_of": iso(NOW - 30 - 600), "stale_after_s": 300},
                {"id": "meters", "as_of": gen},
                {"id": "items", "as_of": gen, "status": "error", "error": "no answer"},
                {"id": "queue", "as_of": gen, "status": "stale"},
                {"id": "machines", "as_of": gen, "status": "disabled"}]
        out = {c["id"]: c for c in gaps.freshness(cols, gen, NOW - 20, NOW, {"meters": 900})}
        self.assertEqual((out["attention"]["age_s"], out["attention"]["state"], out["attention"]["label"]), (620, "old", "Tracker"))
        self.assertEqual((out["meters"]["age_s"], out["meters"]["limit_s"], out["meters"]["state"]), (20, 900, "ok"))
        self.assertEqual((out["items"]["state"], out["queue"]["state"]), ("error", "old"))
        self.assertEqual(out["machines"]["state"], "disabled")   # a surface the source does not read is never "ok"


class Countdown(unittest.TestCase):
    def acc(self, status, empty=None, left=30):
        return {"id": "a", "provider": "Orbit", "account": "Team", "windows": [{"id": "week", "label": "Week", "short": "wk",
                "percent_remaining": left, "resets_at": iso(NOW + 4 * 86400)}],
                "runway": {"status": status, "projected_empty_at": empty}}

    def test_only_from_the_source_projection(self):
        c = allowance.chip(self.acc("exhausts_before_reset", iso(NOW + 11400)), NOW, UTC)
        self.assertEqual(c["countdown_s"], 11400)
        self.assertIn("out in 3 h 10 min", c["forms"][0])
        self.assertIn("in 3 h 10 min", c["sentence"])
        for status, empty in (("through_reset", iso(NOW + 100)), ("exhausts_before_reset", None), ("unknown", None)):
            c = allowance.chip(self.acc(status, empty, left=3), NOW, UTC)   # nearly empty, but no projection: no countdown
            self.assertIsNone(c["countdown_s"], status)

    def test_exhausted_counts_to_its_reset(self):
        c = allowance.chip(self.acc("exhausted", left=0), NOW, UTC)
        self.assertEqual((c["back_in_s"], c["countdown_s"]), (4 * 86400, None))


class RelativeTime(unittest.TestCase):
    def test_words(self):
        self.assertEqual([gaps.span(s) for s in (0, 59, 60, 3599, 3600, 11400, 86400, 93600)],
                         ["0 s", "59 s", "1 min", "59 min", "1 h", "3 h 10 min", "1 d", "1 d 2 h"])
        self.assertEqual((gaps.ago(30), gaps.ago(720), gaps.until(10), gaps.until(3660)), ("just now", "12 min ago", "now", "in 1 h 1 min"))
        self.assertIsNone(gaps.span(None))


class FeedContract12(unittest.TestCase):
    def feed(self, **kw):
        doc = {"schema": "lookout.feed", "schema_version": "1.2", "source": {"id": "s1"}, "items": []}
        doc.update(kw)
        return doc

    def test_1_2_fields(self):
        clean, warn = schema.validate(self.feed(
            items=[item(waiting_on="external", waiting_for="upstream maintainer", waiting_since=iso(NOW), state_since=iso(NOW),
                        agent={"state": "ended", "since": iso(NOW), "as_of": iso(NOW), "reason": "its session ended"})],
            queues=[{"id": "floor", "length": 2, "oldest_wait_s": 30, "held": 1, "cap": 1, "holders": [{"label": "a", "since": iso(NOW)}]}],
            deploys=[{"id": "web", "behind": 3, "oldest_unshipped_at": iso(NOW), "deployed": {"version": "a"}, "head": {"version": "b"}}],
            collectors=[{"id": "attention", "label": "Tracker", "stale_after_s": 600}]))
        self.assertEqual((len(clean["queues"]), len(clean["deploys"]), warn), (1, 1, []))

    def test_older_feeds_get_empty_lists(self):
        clean, _ = schema.validate({"schema": "lookout.feed", "schema_version": "1.0", "source": {"id": "s1"}})
        self.assertEqual((clean["queues"], clean["deploys"]), ([], []))

    def test_wrong_types_and_caps_are_refused(self):
        bad = [self.feed(queues=[{"id": "q", "length": "two"}]), self.feed(queues=[{"label": "no id"}]),
               self.feed(deploys=[{"id": "d", "behind": 1.5}]), self.feed(items=[item(agent={"state": 3})]),
               self.feed(items=[item(waiting_since="yesterday")]),
               self.feed(queues=[{"id": "q%d" % i} for i in range(schema.CAPS["queues"] + 1)])]
        for doc in bad:
            with self.assertRaises(schema.Reject):
                schema.validate(doc)


if __name__ == "__main__":
    unittest.main()
