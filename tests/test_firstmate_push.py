"""Acceptance tests for the firstmate pusher (examples/adapter/firstmate_push.py), over recorded and hand-made fixtures.

    python3 -m unittest tests.test_firstmate_push

The fixtures are in tests/fixtures/firstmate: `ledger-recorded.jsonl` was written by firstmate's own ledger writer in a scratch
home (names, projects and status lines made up), the others are cut, replayed, hostile or from-the-future variants of it, and
`capacity-*.json` are state/lane-capacity.json files. `expected-recorded.json` is the feed the recorded ledger and
`capacity-ok.json` must give at the fixed clock below. To write it again after a change you meant to make, build the feed as
`feed()` does for those two files and dump it with indent=2.

Each test makes a scratch home from the fixtures it names and runs the pusher over it, the way a person would run it with
`--print`. The pusher's output is also checked against the host's own `weatherdeck.schema.validate`, and one test sends it through
`weatherdeck ingest`. Standard library only, no network.
"""
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
FIX = ROOT / "tests" / "fixtures" / "firstmate"
NOW = 1792514500       # shortly after the newest record of the recorded ledger
PUSHER = ROOT / "examples" / "adapter" / "firstmate_push.py"

from weatherdeck import schema  # noqa: E402

_spec = importlib.util.spec_from_file_location("firstmate_push", PUSHER)
fp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fp)


class Homes(unittest.TestCase):
    def home(self, ledger=None, capacity=None, text=None):
        """A scratch firstmate home whose state/ holds the named fixtures (or nothing, for an absent file), or `text` as its ledger."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        state = Path(tmp.name) / "state"
        state.mkdir()
        if ledger or text is not None:
            (state / "fleet-ledger.jsonl").write_bytes((FIX / ledger).read_bytes() if ledger else text.encode())
        if capacity:
            (state / "lane-capacity.json").write_bytes((FIX / capacity).read_bytes())
        return tmp.name

    def feed(self, ledger=None, capacity=None, machine=None, text=None):
        doc = fp.build(fp.collect(self.home(ledger, capacity, text), machine, now=NOW), "firstmate", 60, "boot-1", 1, now=NOW)
        schema.validate(json.loads(json.dumps(doc)))        # the host would take it
        return doc

    def done_titles(self, doc):
        return {d["id"]: d["title"] for d in doc["done"]}

    def items(self, doc):
        return {i["id"]: i for i in doc["items"]}


class Mapping(Homes):
    def test_the_recorded_ledger_gives_the_expected_feed(self):
        self.assertEqual(self.feed("ledger-recorded.jsonl", "capacity-ok.json"),
                         json.loads((FIX / "expected-recorded.json").read_text(encoding="utf-8")))

    def test_each_event_lands_in_its_one_field(self):
        doc = self.feed("ledger-recorded.jsonl")
        items = self.items(doc)
        # task.dispatched and task.status -> items[], the status word -> state, its text -> doing (running) or state_detail
        self.assertEqual({k: v["state"] for k, v in items.items()},
                         {"fix-login": "running", "map-tiles": "running", "docs-sweep": "waiting", "flaky-test": "blocked",
                          "cache-warm": "paused", "tidy-config": "failed", "add-export": "done", "remote-home": "running"})
        self.assertEqual(items["fix-login"]["doing"], "bug reproduced")
        self.assertNotIn("state_detail", items["fix-login"])
        self.assertEqual(items["docs-sweep"]["state_detail"], "which of the two layouts should the index page use?")
        self.assertNotIn("doing", items["docs-sweep"])
        self.assertEqual((items["map-tiles"]["kind"], items["map-tiles"]["project"]), ("scout", "atlas"))
        self.assertEqual(items["remote-home"]["kind"], "secondmate")
        self.assertNotIn("project", items["remote-home"])            # a remote second mate has none
        # task.pr_ready -> link
        self.assertEqual(items["add-export"]["link"], {"url": "https://github.com/acme/webapp/pull/7", "label": "pull request"})
        # task.merged and task.cleaned_up -> done[]: a merge carries its via and PR, a cleanup with no merge before it says so in
        # its title and carries neither; either way the task is no longer an item
        self.assertEqual([(d["title"], d.get("via")) for d in doc["done"]],
                         [("abandoned (cleaned up, no merge recorded)", None), ("local-fix", "local"), ("old-bug", "pr")])
        self.assertNotIn("link", doc["done"][0])
        self.assertEqual(doc["done"][2]["link"]["url"], "https://github.com/acme/webapp/pull/5")
        for gone in ("old-bug", "local-fix", "abandoned"):
            self.assertNotIn(gone, items)

    def test_no_liveness_is_ever_invented(self):
        doc = self.feed("ledger-recorded.jsonl", "capacity-ok.json")
        for item in doc["items"]:
            self.assertEqual(item["agent"]["state"], "unknown")
            self.assertNotIn("summary", item)                       # the worker's words are never the board's sentence
            self.assertNotIn("lane", item)                          # and no lane word, which the ledger cannot say
            self.assertNotIn("needs_you", item)
        self.assertEqual(doc["attention"], [])
        self.assertNotIn("machine", doc["source"])                  # never the machine's own source
        self.assertNotIn("running", doc["machines"][0]["lanes"])    # how many lanes run is not recorded

    def test_the_status_word_table(self):
        lines = "".join(json.dumps({"v": 1, "ts": 1792514000 + n, "event": "task.status", "task": "t-" + w, "state": w, "key": None,
                                    "text": " x"}) + "\n" for n, w in enumerate(
                                        ("working", "needs-decision", "blocked", "paused", "done", "failed", "resolved", "parked")))
        got = {k[2:]: v["state"] for k, v in self.items(self.feed(text=lines)).items()}
        self.assertEqual(got, {"working": "running", "needs-decision": "waiting", "blocked": "blocked", "paused": "paused",
                               "done": "done", "failed": "failed", "resolved": "unknown", "parked": "unknown"})


class Gaps(Homes):
    def test_an_absent_ledger_pushes_nothing(self):
        with self.assertRaises(fp.Nothing):
            fp.collect(self.home(None, "capacity-ok.json"), now=NOW)     # the lane-capacity file alone is not a ledger
        with self.assertRaises(fp.Nothing):
            fp.collect(os.path.join(self.home(), "no-such-home"), now=NOW)
        out = subprocess.run([sys.executable, str(PUSHER), "--home", self.home(), "--print"], capture_output=True, text=True, timeout=60)
        self.assertEqual((out.returncode, out.stdout), (0, ""))
        self.assertIn("nothing to push", out.stderr)

    def test_an_empty_ledger_says_no_records_and_no_more(self):
        doc = self.feed("ledger-empty.jsonl")
        self.assertEqual((doc["items"], doc["done"], doc["omitted"], doc["machines"]), ([], [], [], []))
        self.assertEqual(doc["collectors"][0]["status"], "ok")

    def test_a_truncated_ledger_reads_only_whole_lines(self):
        doc = self.feed("ledger-truncated.jsonl")
        self.assertEqual(doc["collectors"][0]["warnings"], 1)           # the cut line is counted, not read
        items = self.items(doc)
        self.assertEqual(sorted(items), ["cache-warm", "docs-sweep", "fix-login", "flaky-test", "map-tiles", "tidy-config"])
        self.assertEqual(items["tidy-config"]["state"], "unknown")      # its status line is the one that was cut
        self.assertNotIn("state_detail", items["tidy-config"])
        whole = (FIX / "ledger-recorded.jsonl").read_text(encoding="utf-8").splitlines()[0]
        doc = self.feed(text=whole)                                      # a whole record with no newline yet is still being written
        self.assertEqual((doc["items"], doc["collectors"][0]["warnings"]), ([], 1))
        self.assertEqual(len(self.feed(text=whole + "\n")["items"]), 1)

    def test_a_ledger_with_content_and_no_usable_record_is_an_error_not_an_empty_fleet(self):
        for text in ("{truncated", "not json\n", '{"v":2,"event":"task.dispatched","task":"a","ts":1}\n\n{"v":1}\n'):
            doc = self.feed(text=text)
            self.assertEqual((doc["items"], doc["done"]), ([], []))
            col = doc["collectors"][0]
            self.assertEqual((col["id"], col["status"]), ("items", "error"), text)
            self.assertIn("none is a usable record", col["error"])
        first = self.feed("ledger-recorded.jsonl")
        self.assertEqual(first["collectors"][0]["status"], "ok")
        home = self.home("ledger-recorded.jsonl")                       # the same home, its ledger then replaced by a cut line
        (Path(home) / "state" / "fleet-ledger.jsonl").write_bytes(b"{truncated")
        doc = fp.build(fp.collect(home, now=NOW), "firstmate", 60, "boot-1", 2, now=NOW)
        self.assertEqual((doc["items"], doc["collectors"][0]["status"]), ([], "error"))
        for text in ("", "\n\n"):                                       # an empty ledger, or one of blank lines, has nothing wrong with it
            self.assertEqual(self.feed(text=text)["collectors"][0]["status"], "ok")

    def test_unknown_events_members_versions_and_lines_are_ignored(self):
        doc = self.feed("ledger-unknown.jsonl")
        items = self.items(doc)
        self.assertEqual(doc["collectors"][0]["warnings"], 8)           # v 2, v true, not JSON, an array, string ts, no task, bad task, NaN ts
        self.assertEqual(sorted(items), ["alpha", "beta", "gamma", "theta"])     # the unknown event made no item for "ghost"
        for item in items.values():
            self.assertEqual(item["state"], "unknown")                  # resolved, parked, no word, WORKING: none says what work is doing
        self.assertEqual(items["alpha"]["state_detail"], "answered: use layout b")
        self.assertNotIn("kind", items["beta"])                         # a kind this reader does not know is left out
        self.assertEqual(items["alpha"]["project"], "webapp")           # unknown members changed nothing else

    def test_repeated_records_are_one_task_one_state_one_landing(self):
        doc = self.feed("ledger-replayed.jsonl")
        items = self.items(doc)
        self.assertEqual(len(items), len(doc["items"]))
        self.assertEqual(sorted(items), ["dup", "midlife", "pr-twice", "race", "replay", "reuse", "steady"])
        self.assertEqual((items["replay"]["state"], items["replay"]["doing"]), ("running", "step three"))    # a replayed batch ends where it did
        self.assertEqual(items["steady"]["state_since"], "2026-10-20T16:33:51Z")      # same word again: the first time stands (1792514031)
        self.assertEqual(items["steady"]["doing"], "still compiling")
        self.assertEqual((items["dup"]["state"], items["dup"]["started_at"]), ("running", "2026-10-20T16:34:20Z"))   # the same launch, recorded twice
        self.assertEqual(items["pr-twice"]["link"]["url"], "https://github.com/acme/webapp/pull/22")   # the replacement PR wins
        self.assertEqual(items["race"]["doing"], "first line before its dispatch")   # a status recorded before its dispatch is kept
        self.assertEqual(items["race"]["kind"], "ship")
        self.assertNotIn("started_at", items["midlife"])                # a task with no dispatch record has no start time to claim
        self.assertEqual((items["reuse"]["kind"], items["reuse"]["doing"]), ("scout", "second life"))   # a reused id is a new task
        self.assertEqual(sorted((d["id"], d.get("via")) for d in doc["done"]),
                         [("batch-twice@1792514131", "pr"), ("dropped@1792514122", None), ("reuse@1792514092", "local"),
                          ("stray-twice@1792514141", "local"), ("stray@1792514101", "local"), ("twice-merged@1792514081", "pr")])
        self.assertEqual(self.done_titles(doc)["dropped@1792514122"], "dropped (cleaned up, no merge recorded)")
        self.assertEqual(len({d["id"] for d in doc["done"]}), len(doc["done"]))      # a batch delivered again, dispatch and merge, lands once
        self.assertNotIn("batch-twice", items)                          # the replayed dispatch does not open a merged task again
        self.assertNotIn("stray-twice", items)
        self.assertNotIn("stray", items)                                # a status line after the cleanup does not bring the task back
        self.assertNotIn("dropped", items)                              # cleaned up with no merge: not open, and a row that says so

    def test_a_cleanup_with_no_earlier_record_is_ignored(self):
        doc = self.feed(text='{"v":1,"ts":1792514000,"event":"task.cleaned_up","task":"orphan"}\n')    # alone in the ledger
        self.assertEqual((doc["items"], doc["done"], doc["collectors"][0]["warnings"]), ([], [], 0))
        doc = self.feed("ledger-orphan-cleanup.jsonl")                  # first in a ledger, after a task's end, and for a task cleaned up twice
        self.assertEqual(sorted(self.items(doc)), ["live"])
        self.assertEqual(self.items(doc)["live"]["doing"], "going")
        self.assertEqual({d["id"]: d["title"] for d in doc["done"]},      # a cleanup after a merge, or a second cleanup, adds no row
                         {"twice-clean@1792514012": "twice-clean",
                          "dropped-twice@1792514032": "dropped-twice (cleaned up, no merge recorded)"})
        self.assertNotIn("link", [d for d in doc["done"] if d["id"].startswith("dropped-twice")][0])

    def test_hostile_ledger_text_stays_text(self):
        doc = self.feed("ledger-hostile.jsonl")
        items = self.items(doc)
        self.assertEqual(sorted(items), ["inj", "long", "plainpr"])     # "has space" is not a task id
        inj = items["inj"]
        self.assertEqual(inj["doing"], "line1 line2 <script>alert(1)</script> end")    # control and direction marks gone, still inert text
        self.assertEqual(inj["project"], "web app x")
        self.assertEqual((inj["title"], inj["state"]), ("inj", "running"))               # members the record had no business sending changed nothing
        for key in ("summary", "needs_you", "state_detail"):
            self.assertNotIn(key, inj)
        self.assertNotIn("link", inj)                                   # a javascript: address is not a link
        self.assertEqual(len(items["long"]["state_detail"]), fp.TEXT_MAX)
        self.assertTrue(items["long"]["state_detail"].endswith("…"))
        self.assertEqual(items["plainpr"]["link"]["url"], "http://example.com/acme/webapp/pull/9")


    def test_an_id_url_or_word_with_a_trailing_newline_is_not_well_formed(self):
        def rec(**kw):
            return json.dumps({"v": 1, "ts": 1792514000, **kw}) + "\n"
        text = (rec(event="task.dispatched", task="a\n", kind="ship", project="p", harness="h", model=None)
                + rec(event="task.dispatched", task="b", kind="ship", project="p", harness="h", model=None)
                + rec(event="task.status", task="b", state="working\n", key=None, text=" x")
                + rec(event="task.pr_ready", task="b", pr="https://x.example/1\n"))
        doc = self.feed(text=text)
        self.assertEqual(doc["collectors"][0]["warnings"], 1)           # "a\n" is not a task id
        items = self.items(doc)
        self.assertEqual(list(items), ["b"])
        self.assertEqual(items["b"]["state"], "unknown")                # a status word with a newline is no word
        self.assertNotIn("link", items["b"])
        for source in ("firstmate\n", "Firstmate"):
            out = subprocess.run([sys.executable, str(PUSHER), "--home", self.home("ledger-empty.jsonl"), "--print", "--source", source],
                                 capture_output=True, text=True, timeout=60)
            self.assertEqual((out.returncode, out.stdout), (2, ""))
            self.assertIn("--source", out.stderr)

    def test_a_record_at_time_zero_is_shown_as_time_zero(self):
        text = "".join(json.dumps(r) + "\n" for r in (
            {"v": 1, "ts": 0, "event": "task.dispatched", "task": "epoch", "kind": "ship", "project": "p", "harness": "h", "model": None},
            {"v": 1, "ts": 0, "event": "task.status", "task": "epoch", "state": "working", "key": None, "text": " x"},
            {"v": 1, "ts": 0, "event": "task.dispatched", "task": "gone", "kind": "ship", "project": "p", "harness": "h", "model": None},
            {"v": 1, "ts": 0, "event": "task.merged", "task": "gone", "via": "local"}))
        doc = self.feed(text=text)
        self.assertEqual((doc["items"][0]["started_at"], doc["items"][0]["state_since"]), ("1970-01-01T00:00:00Z",) * 2)
        self.assertEqual(doc["done"][0]["at"], "1970-01-01T00:00:00Z")
        with mock.patch.object(fp.time, "time", return_value=NOW):
            self.assertEqual(fp.now_iso(None), fp.now_iso(NOW))         # no time given: now


class Capacity(Homes):
    def test_absent_lane_capacity_is_not_an_error(self):
        doc = self.feed("ledger-recorded.jsonl")
        self.assertEqual(doc["machines"], [])
        self.assertEqual([c["id"] for c in doc["collectors"]], ["items"])
        self.assertNotIn("machine", doc["items"][0])                    # no machine is named that nothing named

    def test_lane_capacity_gives_lane_count_and_pressure_with_their_age(self):
        doc = self.feed("ledger-recorded.jsonl", "capacity-ok.json")
        self.assertEqual(doc["machines"], [{"id": "desk-pc", "status": "unknown", "as_of": "2026-10-20T16:40:40Z",
                                            "lanes": {"total": 8}, "pressure": {"level": "warn", "why": ["memory: 3.1 GB available of 32"]}}])
        self.assertEqual(doc["collectors"][1], {"id": "machines", "label": "lane-capacity", "as_of": "2026-10-20T16:40:40Z",
                                                "stale_after_s": 600, "status": "ok"})
        self.assertEqual({i["machine"] for i in doc["items"]}, {"desk-pc"})
        self.assertEqual(doc["omitted"], [])                            # 8 lanes counted, 8 open in the ledger
        self.assertEqual(self.feed("ledger-recorded.jsonl", "capacity-ok.json", machine="skiff")["machines"][0]["id"], "skiff")

    def test_unknown_members_and_unknown_values_stay_absent(self):
        doc = self.feed("ledger-empty.jsonl", "capacity-partial.json")
        row = doc["machines"][0]
        self.assertEqual(set(row), {"id", "status", "as_of"})           # no lane count sent, level "unknown" sent as nothing
        self.assertEqual(doc["collectors"][1]["status"], "ok")

    def test_lane_capacity_that_cannot_be_used_is_said_and_the_ledger_still_goes(self):
        for name, why in (("capacity-other-version.json", "is not fm-lane-capacity.v1"), ("capacity-not-json.json", "is not JSON"),
                          ("capacity-no-epoch.json", "carries no generated_epoch, so its age is unknown")):
            doc = self.feed("ledger-recorded.jsonl", name)
            self.assertEqual(doc["machines"], [], name)
            self.assertEqual(doc["collectors"][1]["status"], "error", name)
            self.assertEqual(doc["collectors"][1]["error"], "state/lane-capacity.json " + why, name)
            self.assertEqual(len(doc["items"]), 8, name)

    def test_lanes_the_home_counts_that_the_ledger_cannot_show_are_declared(self):
        cap = json.loads((FIX / "capacity-ok.json").read_text(encoding="utf-8"))
        cap["lanes"]["count"] = 11
        home = Path(self.home("ledger-recorded.jsonl"))
        (home / "state" / "lane-capacity.json").write_text(json.dumps(cap), encoding="utf-8")
        doc = fp.build(fp.collect(str(home), now=NOW), "firstmate", 60, "boot-1", 1, now=NOW)
        schema.validate(json.loads(json.dumps(doc)))
        self.assertEqual(len(doc["items"]), 8)
        self.assertEqual(doc["machines"][0]["lanes"], {"total": 11})
        self.assertEqual([(o["surface"], o["shown"], o["total"]) for o in doc["omitted"]], [("items", 8, 11)])
        cap["lanes"]["count"] = 3                                       # fewer than the ledger shows open: nothing is claimed
        (home / "state" / "lane-capacity.json").write_text(json.dumps(cap), encoding="utf-8")
        self.assertEqual(fp.collect(str(home), now=NOW)["omitted"], [])


class Limits(Homes):
    def test_lists_are_capped_and_the_true_totals_declared(self):
        lines = []
        for n in range(75):                                              # 75 open tasks, newest last
            lines.append({"v": 1, "ts": 1792514000 + n, "event": "task.dispatched", "task": "open-%02d" % n, "kind": "ship",
                          "project": "webapp", "harness": "harness-a", "model": None})
        for n in range(40):                                              # and 40 landings
            lines.append({"v": 1, "ts": 1792514200 + n, "event": "task.merged", "task": "gone-%02d" % n, "via": "local"})
        doc = self.feed(text="".join(json.dumps(r) + "\n" for r in lines))
        self.assertEqual((len(doc["items"]), len(doc["done"])), (fp.CAP_ITEMS, fp.CAP_DONE))
        self.assertEqual(doc["items"][0]["id"], "open-74")                # the most recently active stay
        self.assertEqual(doc["done"][0]["title"], "gone-39")
        self.assertEqual([(o["surface"], o["shown"], o["total"]) for o in doc["omitted"]], [("items", 60, 75), ("done", 30, 40)])
        self.assertLess(len(json.dumps(doc)), 256 * 1024)

    def test_the_same_files_give_the_same_feed(self):
        home = self.home("ledger-recorded.jsonl", "capacity-ok.json")
        build = lambda: fp.build(fp.collect(home, now=NOW), "firstmate", 60, "boot-1", 1, now=NOW)  # noqa: E731
        self.assertEqual(build(), build())

    def test_the_home_is_left_exactly_as_it_was(self):
        home = self.home("ledger-recorded.jsonl", "capacity-ok.json")

        def snapshot():
            return sorted((str(p.relative_to(home)), p.stat().st_size, p.stat().st_mtime_ns, hashlib.sha256(p.read_bytes()).hexdigest())
                          for p in Path(home).rglob("*") if p.is_file()) + sorted(str(p.relative_to(home)) for p in Path(home).rglob("*"))
        before = snapshot()
        subprocess.run([sys.executable, str(PUSHER), "--home", home, "--print"], capture_output=True, text=True, timeout=60, check=True)
        fp.collect(home, now=NOW)
        self.assertEqual(snapshot(), before)


class Host(Homes):
    def test_the_host_takes_the_feed_and_it_never_takes_a_machines_row_from_its_own_source(self):
        data = tempfile.TemporaryDirectory()
        self.addCleanup(data.cleanup)
        env = dict(os.environ, WEATHERDECK_DATA=data.name, PYTHONDONTWRITEBYTECODE="1", PYTHONPATH=str(ROOT / "src"))
        beat = {"schema": "lookout.feed", "schema_version": "1.0", "source": {"id": "beat", "machine": "desk-pc"},
                "generated_at": "2026-10-20T16:41:00Z",
                "machines": [{"id": "desk-pc", "label": "Desk PC", "status": "ok", "load": {"l1": 0.5, "cores": 8}}]}
        mine = fp.build(fp.collect(self.home("ledger-recorded.jsonl", "capacity-ok.json"), now=NOW), "firstmate", 60, "boot-1", 1, now=NOW)
        for doc in (beat, mine):                                          # ours arrives last, which would win were it the machine's own source
            out = subprocess.run([sys.executable, str(ROOT / "bin" / "weatherdeck"), "ingest"], input=json.dumps(doc), capture_output=True,
                                 text=True, env=env, timeout=60)
            self.assertTrue(out.returncode == 0 and out.stdout.startswith("ok"), out.stdout + out.stderr)
        out = subprocess.run([sys.executable, "-c", "import json, sys; from weatherdeck import view; json.dump(view.build(), sys.stdout)"],
                             capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        view = json.loads(out.stdout)
        machine = {m["id"]: m for m in view["machines"]}["desk-pc"]
        self.assertEqual((machine["status"], machine["load"]["cores"]), ("ok", 8))              # the beat's measurements stand
        self.assertEqual((machine["lanes"]["total"], machine["lanes"]["running"], machine["lanes"]["or_more"]), (8, 0, True))
        self.assertEqual(sorted(i["id"] for i in view["items"]), sorted(i["id"] for i in mine["items"]))
        self.assertEqual({i["agent"]["state"] for i in view["items"]}, {"unknown"})


if __name__ == "__main__":
    unittest.main()
