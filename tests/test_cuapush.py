"""Acceptance tests for the Cua Spaces pusher (`examples/adapter/cua_push.py`), added after 0.10.1 (unreleased).

    python3 -m unittest discover -s tests

Added at the owner's request, as an exception to "an adapter for a specific tool is tested in its own repository" (CONTRIBUTING.md,
"Tests"): the pusher's mapping from `cua` output to a feed, over the synthetic fixtures in `tests/fixtures/cua/` (normal, offline
host, crashed run, schema drift, signed out) and a command that is not installed. The fixtures are hand-written from Cua's published
description, not recorded from a live cua, so these tests prove the mapping and the gaps, not that the real cua prints these shapes.
Synthetic data, standard library, no network, no cua; the clock is injected; every feed is checked with the host's own validator.
"""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "examples" / "adapter"))

import cua_push  # noqa: E402
from weatherdeck import schema  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures" / "cua"
T0 = 1_800_000_000  # 2027-01-15T08:00:00Z, a fixed clock


class Recording(cua_push.Cli):
    """The fixture reader that remembers every command it was asked to run."""

    def __init__(self, scenario):
        super().__init__("cua", str(FIXTURES / scenario))
        self.calls = []

    def run(self, args):
        self.calls.append(list(args))
        return super().run(args)


def read(scenario, state=None):
    return cua_push.read_cua(Recording(scenario), {} if state is None else state, T0)


def feed_of(scenario, seen=None, noted=None):
    got = read(scenario)
    doc = cua_push.build(got, T0, 60, "boot", 1, set() if seen is None else seen, {} if noted is None else noted)
    schema.validate(json.loads(json.dumps(doc)))        # the host would accept it
    return doc


def by_id(rows):
    return {r["id"]: r for r in rows}


def notes(doc):
    return [e["text"] for e in doc["events"] if e["kind"] == "note"]


class Normal(unittest.TestCase):
    def setUp(self):
        self.doc = feed_of("normal")

    def test_envelope_and_producer(self):
        d = self.doc
        self.assertEqual((d["schema"], d["schema_version"], d["source"]["id"], d["interval_s"]), ("lookout.feed", "1.12", "cua", 60))
        self.assertEqual(d["producer"], {"name": "cua_push", "version": "1", "boot_id": "boot", "seq": 1, "mode": "live"})
        self.assertEqual(d["omitted"], [])

    def test_a_host_is_a_machine_with_its_spaces_in_extras_and_no_vitals(self):
        machines = by_id(self.doc["machines"])
        self.assertEqual(set(machines), {"mini-host", "laptop-host"})
        self.assertEqual([x["label"] for x in machines["mini-host"]["extras"]], ["space alpha", "space beta"])
        self.assertEqual((machines["mini-host"]["status"], machines["laptop-host"]["status"]), ("ok", "ok"))
        self.assertEqual(machines["mini-host"]["lanes"], {"running": 1, "total": 3})
        for m in machines.values():                      # cua reports no load, memory or disk: none is invented
            self.assertFalse({"load", "mem", "io", "disks", "pressure", "beat", "uptime_s", "on_battery", "health"} & set(m))

    def test_runs_are_lanes_with_cuas_own_words(self):
        items = by_id(self.doc["items"])
        self.assertEqual({k: (v["state"], v["lane"]["state"], v["lane"]["cause"]) for k, v in items.items()}, {
            "sp-alpha:run-1": ("running", "Working", "cua-run-running"),
            "sp-alpha:run-2": ("waiting", "Waiting on the supervisor", "cua-run-idle-takes-message"),
            "sp-beta:run-3": ("unknown", "Can't tell", "cua-run-idle"),
            "sp-gamma:run-4": ("running", "Working", "cua-run-running")})
        self.assertEqual(items["sp-alpha:run-1"]["doing"], "running the test suite")      # the run's words: doing, never summary
        self.assertNotIn("running the test suite", items["sp-alpha:run-1"]["summary"])
        self.assertEqual(items["sp-alpha:run-1"]["started_at"], "2026-10-20T08:00:00Z")
        self.assertEqual(items["sp-alpha:run-2"]["started_at"], "2026-10-20T07:00:00Z")
        self.assertNotIn("agent", items["sp-alpha:run-1"])          # liveness is only what cua says, and the list did not
        self.assertEqual(items["sp-gamma:run-4"]["agent"]["state"], "alive")    # asked for by `agent status`, which said alive
        self.assertEqual(items["sp-gamma:run-4"]["started_at"], "2026-10-20T08:00:00Z")      # epoch seconds read as a time

    def test_lane_order_puts_calls_for_attention_first(self):
        self.assertEqual([i["lane"]["state"] for i in self.doc["items"]], ["Waiting on the supervisor", "Can't tell", "Working", "Working"])

    def test_an_access_request_is_a_card_and_an_answered_one_is_not(self):
        self.assertEqual(self.doc["attention"], [{"id": "cua-notice:n-1", "kind": "approval", "severity": "action", "title": "Cua access request",
                                                  "detail": "run-2 asks to read a folder", "since": "2026-10-20T08:05:00Z",
                                                  "item": "sp-alpha:run-2", "how": "answer it in Cua; the board is read-only"}])

    def test_a_turn_end_is_an_event_said_once(self):
        turn = [e for e in self.doc["events"] if e["kind"] == "update"]
        self.assertEqual(turn, [{"at": 1792483560, "item": "sp-alpha:run-1", "kind": "update", "text": "turn ended: finished a turn"}])
        seen, noted = set(), {}
        first = cua_push.build(read("normal"), T0, 60, "boot", 1, seen, noted)
        second = cua_push.build(read("normal"), T0 + 60, 60, "boot", 2, seen, noted)
        self.assertEqual(len([e for e in first["events"] if e["kind"] == "update"]), 1)
        self.assertEqual(second["events"], [])          # nothing new: no turn end again, no note again

    def test_usage_is_one_allowance_chip_with_runway_unknown(self):
        acc = self.doc["meters"]["accounts"][0]
        self.assertEqual((acc["id"], acc["provider"], acc["account"], acc["runway"]), ("cua", "Cua", "Team", {"status": "unknown"}))
        self.assertEqual([(w["id"], w["percent_remaining"], w["resets_at"]) for w in acc["windows"]],
                         [("live_sessions", 60.0, None), ("remote_hours", 75.0, "2026-11-01T00:00:00Z")])

    def test_the_cua_version_is_on_the_collector_and_said_once(self):
        self.assertEqual(by_id(self.doc["collectors"])["cua"]["label"], "cua 0.7.3")
        self.assertEqual(notes(self.doc), ["cua: read from cua 0.7.3; its contract is experimental, so shapes may move"])
        self.assertEqual({c["status"] for c in self.doc["collectors"]}, {"ok"})

    def test_two_runs_over_the_same_fixture_agree(self):
        a, b = feed_of("normal"), feed_of("normal")
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))

    def test_only_read_only_verbs_are_run_and_the_slow_ones_seldom(self):
        cli, state = Recording("normal"), {}
        cua_push.read_cua(cli, state, T0)
        cua_push.read_cua(cli, state, T0 + 60)
        self.assertEqual([c for c in cli.calls if c != ["--version"]].count(["usage", "--json"]), 1)
        self.assertEqual(cli.calls.count(["--version"]), 1)
        self.assertEqual({tuple(c[:2]) for c in cli.calls}, {("--version",), ("spaces", "ls"), ("agent", "ls"), ("agent", "status"),
                                                           ("notifications", "ls"), ("usage", "--json")})
        for c in cli.calls:
            self.assertTrue(c == ["--version"] or c[-1] == "--json", c)
        cua_push.read_cua(cli, state, T0 + cua_push.SLOW_EVERY_S)
        self.assertEqual(cli.calls.count(["--version"]), 2)


class OfflineHost(unittest.TestCase):
    def setUp(self):
        self.doc = feed_of("offline-host")
        self.machines, self.items = by_id(self.doc["machines"]), by_id(self.doc["items"])

    def test_an_offline_host_is_never_ok(self):
        self.assertEqual(self.machines["laptop-host"]["status"], "down")        # `offline` and `not sharing`
        self.assertEqual(self.machines["mini-host"]["status"], "ok")
        self.assertEqual([x["severity"] for x in self.machines["laptop-host"]["extras"]], ["warn", "warn"])
        self.assertEqual([x["value"] for x in self.machines["laptop-host"]["extras"]], ["offline", "not sharing"])
        self.assertNotIn("health", self.machines["laptop-host"])                # no critical "lost" card for a laptop that closed

    def test_its_runs_are_unknown_not_what_cua_last_said(self):
        for rid in ("sp-delta:run-5", "sp-eps:run-6"):
            it = self.items[rid]
            self.assertEqual((it["state"], it["lane"], it["agent"]["state"]), ("unknown", {"state": "Can't tell", "cause": "cua-host-offline"}, "unknown"))
            self.assertNotIn("doing", it)
        self.assertEqual(self.items["sp-alpha:run-1"]["state"], "running")

    def test_the_running_count_of_an_offline_host_is_absent_not_zero(self):
        self.assertEqual(self.machines["laptop-host"]["lanes"], {"total": 2})
        self.assertEqual(self.machines["mini-host"]["lanes"], {"running": 1, "total": 1})

    def test_a_run_on_a_space_of_an_unrecognised_phase_is_unknown_not_what_cua_last_said(self):
        it = self.items["sp-zeta:run-10"]
        self.assertEqual((it["state"], it["lane"], it["agent"]["state"]), ("unknown", {"state": "Can't tell", "cause": "cua-space-phase-unknown"}, "unknown"))
        self.assertNotIn("doing", it)
        self.assertEqual(self.machines["dock-host"]["status"], "unknown")
        self.assertEqual(self.machines["dock-host"]["lanes"], {"total": 1})
        got = read("offline-host")
        got["spaces"] = ("ok", [{"id": "sp-x", "host": "h"}])
        got["runs"] = ("ok", [{"id": "r1", "space": "sp-x", "status": "running"}])
        doc = cua_push.build(got, T0, 60, "boot", 1, set(), {})
        self.assertEqual(doc["items"][0]["lane"]["cause"], "cua-space-phase-unknown")      # no phase at all reads the same

    def test_a_run_naming_its_offline_space_by_name_is_unknown_too(self):
        got = read("offline-host")
        got["runs"] = ("ok", [{"id": "run-5", "space": "delta", "status": "running", "task": "was running"}])
        doc = cua_push.build(got, T0, 60, "boot", 1, set(), {})
        it = doc["items"][0]
        self.assertEqual((it["state"], it["lane"]["cause"], "doing" in it), ("unknown", "cua-host-offline", False))
        self.assertEqual(it["machine"], "laptop-host")

    def test_a_run_whose_space_is_not_listed_is_unknown_not_what_cua_last_said(self):
        for spaces in (("ok", []), ("bad", "`cua spaces ls` failed: exit 1"), ("off", "not offered")):
            got = read("offline-host")
            got["spaces"] = spaces
            got["runs"] = ("ok", [{"id": "run-5", "space": "delta", "status": "running", "task": "was running"}, {"id": "run-6", "status": "failed"}])
            doc = cua_push.build(got, T0, 60, "boot", 1, set(), {})
            self.assertEqual([(i["state"], i["lane"]["cause"], i["agent"]["state"], "doing" in i) for i in doc["items"]],
                             [("unknown", "cua-space-unlisted", "unknown", False)] * 2, spaces[0])
            self.assertNotIn("machine", doc["items"][0])

    def test_a_space_name_two_hosts_share_is_not_guessed(self):
        got = read("offline-host")
        got["spaces"] = ("ok", [{"id": "a1", "name": "dev", "host": "laptop", "phase": "offline"},
                                {"id": "b1", "name": "dev", "host": "mini", "phase": "running"}])
        got["runs"] = ("ok", [{"id": "r1", "space": "dev", "status": "running"}, {"id": "r2", "space": "a1", "status": "running"},
                              {"id": "r3", "space": "b1", "status": "running"}])
        doc = cua_push.build(got, T0, 60, "boot", 1, set(), {})
        schema.validate(json.loads(json.dumps(doc)))
        items = by_id(doc["items"])
        self.assertEqual((items["dev:r1"]["lane"]["cause"], "machine" in items["dev:r1"]), ("cua-space-unlisted", False))
        self.assertEqual((items["a1:r2"]["lane"]["cause"], items["a1:r2"]["machine"]), ("cua-host-offline", "laptop"))
        self.assertEqual((items["b1:r3"]["lane"]["cause"], items["b1:r3"]["machine"]), ("cua-run-running", "mini"))
        self.assertEqual(by_id(doc["machines"])["mini"]["lanes"], {"running": 1, "total": 1})

    def test_a_run_id_listed_twice_is_one_lane_and_said_once(self):
        got = read("offline-host")
        got["spaces"] = ("ok", [{"id": "a1", "name": "dev", "host": "laptop", "phase": "running"},
                                {"id": "b1", "name": "dev", "host": "mini", "phase": "running"}])
        got["runs"] = ("ok", [{"id": "r1", "space": "a1", "status": "running"}, {"id": "r1", "space": "b1", "status": "idle"}])
        got["notices"] = ("ok", [{"id": "n1", "kind": "access_request", "run": "r1"}])
        doc = cua_push.build(got, T0, 60, "boot", 1, set(), {})
        schema.validate(json.loads(json.dumps(doc)))
        self.assertEqual([i["id"] for i in doc["items"]], ["a1:r1"])
        self.assertEqual(doc["attention"][0]["item"], "a1:r1")
        self.assertEqual(by_id(doc["collectors"])["items"]["warnings"], 1)

    def test_a_host_with_one_space_up_and_one_down_is_a_warning(self):
        got = read("offline-host")
        got["spaces"] = ("ok", [{"id": "a", "host": "h", "phase": "running"}, {"id": "b", "host": "h", "phase": "offline"}])
        doc = cua_push.build(got, T0, 60, "boot", 1, set(), {})
        self.assertEqual(doc["machines"][0]["status"], "warn")

    def test_a_phase_this_pusher_does_not_know_reads_unknown(self):
        got = read("offline-host")
        got["spaces"] = ("ok", [{"id": "a", "host": "h", "phase": "hibernating"}, {"id": "b"}])
        doc = cua_push.build(got, T0, 60, "boot", 1, set(), {})
        self.assertEqual({m["id"]: m["status"] for m in doc["machines"]}, {"h": "unknown", "cua-host-not-reported": "unknown"})


class CrashedRun(unittest.TestCase):
    def setUp(self):
        self.doc = feed_of("crashed-run")
        self.items = by_id(self.doc["items"])

    def test_crashed_is_gone_and_needs_attention(self):
        it = self.items["sp-alpha:run-7"]
        self.assertEqual((it["state"], it["lane"], it["agent"]["state"]), ("failed", {"state": "Needs attention", "cause": "cua-run-crashed"}, "gone"))
        self.assertEqual(it["title"], "Migrate the schema")

    def test_failed_needs_attention_with_no_agent_claim_and_unknown_is_unknown(self):
        failed, unknown = self.items["sp-alpha:run-8"], self.items["sp-alpha:run-9"]
        self.assertEqual((failed["state"], failed["lane"]["cause"], "agent" in failed), ("failed", "cua-run-failed", False))
        self.assertEqual((unknown["state"], unknown["lane"]["cause"], unknown["agent"]["state"]), ("unknown", "cua-run-unknown", "unknown"))

    def test_the_failures_are_calls_that_name_their_lanes(self):
        cards = by_id(self.doc["attention"])
        self.assertEqual({k: (v["kind"], v["severity"], v["item"]) for k, v in cards.items()},
                         {"cua-notice:n-7": ("decision", "action", "sp-alpha:run-7"), "cua-notice:n-8": ("decision", "action", "sp-alpha:run-8")})
        self.assertEqual(cards["cua-notice:n-8"]["detail"], "tests failed")

    def test_the_lane_order_leads_with_what_needs_attention(self):
        self.assertEqual([i["lane"]["state"] for i in self.doc["items"]], ["Needs attention", "Needs attention", "Can't tell"])

    def test_usage_with_one_window_sends_only_that_window(self):
        self.assertEqual([(w["id"], w["percent_remaining"]) for w in self.doc["meters"]["accounts"][0]["windows"]], [("live_sessions", 100.0)])
        self.assertNotIn("account", self.doc["meters"]["accounts"][0])


class SchemaDrift(unittest.TestCase):
    def setUp(self):
        self.doc = feed_of("schema-drift")
        self.col = by_id(self.doc["collectors"])

    def test_an_answer_of_an_unknown_shape_is_an_error_and_empty_not_zero(self):
        self.assertEqual(self.doc["machines"], [])
        self.assertEqual(self.col["machines"]["status"], "error")
        self.assertIn("unexpected shape", self.col["machines"]["error"])
        self.assertNotIn("meters", self.doc)
        self.assertEqual(self.col["meters"]["status"], "error")

    def test_a_verb_the_cua_lacks_is_disabled_and_its_surface_empty(self):
        self.assertEqual(self.col["attention"]["status"], "disabled")
        self.assertEqual(self.doc["attention"], [])

    def test_a_new_status_reads_unknown_and_a_row_without_an_id_is_left_out(self):
        items = by_id(self.doc["items"])
        self.assertEqual(set(items), {"sp-alpha:run-1", "sp-alpha:run-2"})
        self.assertEqual(items["sp-alpha:run-1"]["state"], "unknown")
        self.assertEqual((items["sp-alpha:run-2"]["state"], items["sp-alpha:run-2"]["lane"]["cause"]), ("unknown", "cua-space-unlisted"))
        self.assertEqual(self.col["items"]["status"], "ok")
        self.assertEqual(self.col["items"]["warnings"], 2)

    def test_a_status_this_pusher_does_not_know_on_a_listed_space_reads_unrecognised(self):
        got = read("schema-drift")
        got["spaces"] = ("ok", [{"id": "sp-alpha", "host": "h", "phase": "running"}])
        items = by_id(cua_push.build(got, T0, 60, "boot", 1, set(), {})["items"])
        self.assertEqual((items["sp-alpha:run-1"]["state"], items["sp-alpha:run-1"]["lane"]["cause"]), ("unknown", "cua-run-status-unrecognised"))
        self.assertEqual((items["sp-alpha:run-2"]["state"], items["sp-alpha:run-2"]["lane"]["cause"]), ("running", "cua-run-running"))

    def test_each_problem_is_said_once_as_a_note_and_not_again(self):
        self.assertEqual(len(notes(self.doc)), len(set(notes(self.doc))))
        said = " ".join(notes(self.doc))
        for part in ("cua spaces ls", "unrecognised run status 'paused'", "1 row(s) without an id", "cua notifications ls", "cua usage", "cua 0.8.0"):
            self.assertIn(part, said)
        seen, noted = set(), {}
        cua_push.build(read("schema-drift"), T0, 60, "boot", 1, seen, noted)
        again = cua_push.build(read("schema-drift"), T0 + 60, 60, "boot", 2, seen, noted)
        self.assertEqual(notes(again), [])
        self.assertEqual(by_id(again["collectors"])["machines"]["status"], "error")     # the state stays in the collector

    def test_a_usage_with_no_limit_sends_no_allowance(self):
        self.assertIn("no readable used and limit pair", self.col["meters"]["error"])


class CannotRun(unittest.TestCase):
    def test_a_missing_cli_exits_cleanly_and_pushes_nothing(self):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(cua_push, "send") as send, contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cua_push.main(["--cua", "cua-is-not-installed-for-this-test", "--sinks", "none.txt"])
        self.assertEqual(code, 0)
        self.assertIn("not installed", err.getvalue())
        self.assertEqual(out.getvalue(), "")
        send.assert_not_called()
        with self.assertRaises(cua_push.Missing):
            cua_push.Cli("cua-is-not-installed-for-this-test")

    def test_signed_out_says_so_and_pushes_nothing(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cua_push.main(["--fixture", str(FIXTURES / "signed-out")])
        self.assertEqual(code, 0)
        self.assertIn("not signed in", err.getvalue())
        self.assertNotIn("{", out.getvalue())                  # no feed was printed
        with self.assertRaises(cua_push.SignedOut):
            read("signed-out")

    def test_a_cua_that_answers_nothing_readable_pushes_nothing(self):
        err = io.StringIO()
        with tempfile.TemporaryDirectory() as empty, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            self.assertEqual(cua_push.main(["--fixture", empty]), 0)
        self.assertIn("nothing readable", err.getvalue())


class Delivery(unittest.TestCase):
    def test_the_feed_is_pushed_with_a_per_host_seq_and_an_interval_that_is_not_below_30_s(self):
        with tempfile.TemporaryDirectory() as tmp:
            sinks = Path(tmp) / "sinks.txt"
            sinks.write_text("one http http://127.0.0.1:1 -\ntwo http http://127.0.0.1:2 -\n", encoding="utf-8")
            sent = []

            def fake(sink, body):
                sent.append((sink["name"], json.loads(body)))
                return True, "ok", False

            with mock.patch.object(cua_push, "send", fake), mock.patch.object(cua_push, "Cli", lambda exe, fixture: Recording("normal")), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(cua_push.main(["--sinks", str(sinks), "--once", "--every", "5"]), 0)
        self.assertEqual([n for n, _ in sent], ["one", "two"])
        self.assertEqual({d["interval_s"] for _, d in sent}, {30})
        self.assertEqual([d["producer"]["seq"] for _, d in sent], [1, 1])
        self.assertEqual(sent[0][1]["items"], sent[1][1]["items"])
        schema.validate(sent[0][1])


class Caps(unittest.TestCase):
    def test_lists_over_the_feed_limits_are_cut_and_declared(self):
        got = read("normal")
        got["spaces"] = ("ok", [{"id": f"x{n}", "host": "crowded", "phase": "running"} for n in range(20)]
                         + [{"id": f"s{n}", "host": f"host-{n}", "phase": "running"} for n in range(15)])
        got["runs"] = ("ok", [{"id": f"r{n}", "space": "x0", "status": "running"} for n in range(70)])
        got["notices"] = ("ok", [{"id": f"n{n}", "kind": "access_request"} for n in range(40)])
        doc = cua_push.build(got, T0, 60, "boot", 1, set(), {})
        schema.validate(json.loads(json.dumps(doc)))
        self.assertEqual((len(doc["items"]), len(doc["attention"]), len(doc["machines"])), (60, 30, 12))
        self.assertEqual({o["surface"]: o["total"] for o in doc["omitted"]},
                         {"items": 70, "attention": 40, "machines": 16, "machines[crowded].extras": 20})
        self.assertEqual(len(by_id(doc["machines"])["crowded"]["extras"]), 12)

    def test_a_long_text_from_cua_is_cut(self):
        got = read("normal")
        got["notices"] = ("ok", [{"id": "n", "kind": "access_request", "title": "x" * 5000}])
        doc = cua_push.build(got, T0, 60, "boot", 1, set(), {})
        schema.validate(json.loads(json.dumps(doc)))
        self.assertLessEqual(len(doc["attention"][0]["detail"]), 200)


if __name__ == "__main__":
    unittest.main()
