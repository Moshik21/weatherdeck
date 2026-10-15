"""Contract tests for the host's own value ledger (src/weatherdeck/ledgerwriter.py, docs/ledger-spec.md, docs/ADDINS.md "Writing the ledger").

Added under the owner's narrow exception (CONTRIBUTING.md): pure core logic, synthetic data (made-up sources, counts and times),
standard library, no network, every time passed in. The history is an in-memory copy of the host's own schema; the only files
touched are temporary ledgers, salts and state files it writes itself in a temporary data directory.
"""
import hashlib
import json
import os
import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import config, ledger, ledgercards, ledgerwriter, store  # noqa: E402

DAY = 86400
D0 = 1800000000 - 1800000000 % DAY      # the start of a UTC day
NOW = D0 + 3 * DAY + 600                 # D0, D0+1, D0+2 are closed days
LOST = 900
SALT = "5a" * 32
RETIRED = re.compile(r"caught|saved|prevent|avert|avoid|spared|rescued", re.I)


def history(sources=("src-a", "src-b"), first_seen=None):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(store.SCHEMA_SQL)
    for s in sources:
        conn.execute("INSERT INTO sources(id, first_seen) VALUES(?,?)", (s, first_seen if first_seen is not None else D0 - DAY))
    return conn


def push(conn, sid, at, status="ok", gap=0, mode=None):
    conn.execute("INSERT INTO pushes(source_id, received_at, status, gap, mode) VALUES(?,?,?,?,?)", (sid, at, status, gap, mode))


def beat(conn, day, sid="src-a", every=600, **kw):
    for t in range(D0 + day * DAY, D0 + (day + 1) * DAY, every):
        push(conn, sid, t, **kw)


def event(conn, at, kind, sample=0, item="x1"):
    conn.execute("INSERT INTO events(source_id, at, owner, item, grp, kind, text, sample) VALUES('src-a',?,'src-a',?,'g',?, 'a title', ?)",
                 (at, item, kind, sample))


def landed(conn, at, key="o/x1", sample=0):
    conn.execute("INSERT INTO done(key, owner, grp, title, via, at, source_id, sample) VALUES(?,'o','g','a title','v',?, 'src-a', ?)", (key, at, sample))


def day(conn, n, host="host-a", now=NOW):
    frm = D0 + n * DAY
    data = ledgerwriter.day_data(conn, frm, LOST)
    return {r["counter"]: r for r in ledgerwriter.compute(data, frm, host, now, LOST, SALT)}


def sha(rows):
    return "sha256:" + hashlib.sha256("\n".join(json.dumps(r, sort_keys=True, separators=(",", ":")) for r in rows).encode()).hexdigest()


class WhatADayHolds(unittest.TestCase):
    def test_a_covered_day_is_counted_with_its_range_and_the_digest_of_exactly_those_rows(self):
        c = history()
        beat(c, 1)
        push(c, "src-a", D0 + DAY + 5, status="rejected")
        push(c, "src-a", D0 + 2 * DAY + 5)                   # the next day is not this day's
        got = day(c, 1)["pushes_ok"]
        self.assertEqual((got["value"], got["quality"], got["coverage"]["covers_window"]), (144, "exact", 1.0))
        rows = [dict(r) for r in c.execute("SELECT id, source_id, received_at, status, COALESCE(gap,0) AS gap, COALESCE(mode,'') AS mode FROM pushes "
                                           "WHERE status='ok' AND received_at>=? AND received_at<? ORDER BY id", (D0 + DAY, D0 + 2 * DAY))]
        self.assertEqual(got["src"]["digest"], sha(rows))
        self.assertEqual((got["src"]["first_ref"], got["src"]["last_ref"]), ("id:%d" % rows[0]["id"], "id:%d" % rows[-1]["id"]))
        self.assertEqual(day(c, 1)["pushes_rejected"]["value"], 1)

    def test_a_day_without_a_single_push_is_unknown_and_never_a_quiet_zero(self):
        c = history()
        beat(c, 0)
        beat(c, 2)
        lines = day(c, 1)
        for name in ledgerwriter.TABLE:
            self.assertEqual((lines[name]["value"], lines[name]["unknown"]), (None, "field-absent"), name)
            self.assertIn("heartbeat", lines[name]["needs"])

    def test_a_quiet_day_with_pushes_is_a_covered_zero_with_an_empty_digest(self):
        c = history()
        beat(c, 1)
        for name in ("pushes_rejected", "feeds_missed", "calls_raised", "surfaced_failed", "restarts", "landed", "silence_episodes"):
            got = day(c, 1)[name]
            self.assertEqual((got["value"], got["quality"] in ("exact", "rebuilt")), (0, True), name)
            self.assertEqual((got["src"]["first_ref"], got["src"]["digest"]), (None, sha([])), name)

    def test_the_first_day_is_a_floor_and_a_floor_of_nothing_is_unknown(self):
        c = history()
        for t in range(D0 + DAY // 2, D0 + DAY, 600):          # the history begins at noon
            push(c, "src-a", t)
        lines = day(c, 0)
        self.assertEqual((lines["pushes_ok"]["quality"], lines["pushes_ok"]["coverage"]["covers_window"]), ("lower-bound", 0.5))
        self.assertEqual((lines["pushes_rejected"]["value"], lines["pushes_rejected"]["unknown"]), (None, "source-truncated"))
        self.assertIsNone(lines["landed"]["src"])

    def test_sample_rows_are_left_out_and_counted_as_left_out(self):
        c = history()
        beat(c, 1)
        beat(c, 1, sid="src-b", mode="sample", every=3600)
        event(c, D0 + DAY + 100, "approval")
        event(c, D0 + DAY + 200, "approval", sample=1, item="x2")
        landed(c, D0 + DAY + 300)
        landed(c, D0 + DAY + 400, key="o/x2", sample=1)
        lines = day(c, 1)
        self.assertEqual((lines["pushes_ok"]["value"], lines["pushes_ok"]["excluded"]), (144, {"sample": 24}))
        self.assertEqual((lines["calls_raised"]["value"], lines["calls_raised"]["excluded"]), (1, {"sample": 1}))
        self.assertEqual((lines["landed"]["value"], lines["landed"]["excluded"]), (1, {"sample": 1}))

    def test_events_count_in_their_own_kinds_and_a_missed_feed_is_the_sum_of_its_gaps(self):
        c = history()
        beat(c, 1)
        for kind, n in (("approval", 2), ("alert", 1), ("failed", 3), ("restart", 1), ("update", 5), ("started", 4)):
            for i in range(n):
                event(c, D0 + DAY + 60 * (i + 1), kind, item="%s%d" % (kind, i))
        push(c, "src-a", D0 + DAY + 1, gap=3)
        push(c, "src-a", D0 + DAY + 2, gap=2)
        lines = day(c, 1)
        self.assertEqual([lines[n]["value"] for n in ("calls_raised", "surfaced_failed", "restarts", "feeds_missed")], [3, 3, 1, 5])

    def test_a_source_that_began_today_makes_the_event_counts_a_floor(self):
        c = history(first_seen=D0 + DAY + 50)
        beat(c, 1)
        event(c, D0 + DAY + 100, "approval")
        got = day(c, 1)["calls_raised"]
        self.assertEqual((got["value"], got["quality"]), (1, "lower-bound"))
        self.assertEqual(day(c, 1)["landed"]["quality"], "exact")
        later = history(first_seen=D0 + 2 * DAY + 50)               # a source that begins a day later changes nothing today
        beat(later, 1)
        self.assertEqual(day(later, 1)["calls_raised"]["quality"], "exact")

    def test_a_source_silent_for_longer_than_lost_after_is_one_episode_on_the_day_it_became_lost(self):
        c = history(("src-a", "src-b"))
        beat(c, 0, "src-b")
        beat(c, 1, "src-b")
        push(c, "src-a", D0 + 1000)
        push(c, "src-a", D0 + 1000 + LOST)                     # exactly lost_after later: not silent
        push(c, "src-a", D0 + 1000 + LOST + LOST + 1)          # one second over lost_after after the second push: lost on day 0
        push(c, "src-a", D0 + DAY - 100)                       # and silent again until here: a second episode on day 0
        push(c, "src-a", D0 + DAY + 4000)                      # lost from D0+DAY-100+LOST, which is day 1, until here
        beat(c, 2, "src-b")
        self.assertEqual(day(c, 0)["silence_episodes"]["value"], 2)
        self.assertEqual(day(c, 0)["silence_episodes"]["quality"], "rebuilt")
        self.assertEqual(day(c, 1)["silence_episodes"]["value"], 2)       # that one, and the open one after the last push
        self.assertEqual(day(c, 2)["silence_episodes"]["value"], 0)       # an episode is counted once, on the day it began

    def test_a_forgotten_source_is_not_counted_as_lost(self):
        c = history(("src-b",))
        beat(c, 1, "src-b")
        push(c, "src-a", D0 + DAY + 100)                       # src-a is no longer in sources
        self.assertEqual(day(c, 1)["silence_episodes"]["value"], 0)

    def test_every_source_has_an_opaque_counter_and_its_key_says_nothing(self):
        c = history()
        beat(c, 1, "src-a")
        beat(c, 1, "src-b", every=1200)
        lines = day(c, 1)
        mine = {n: l["value"] for n, l in lines.items() if n.startswith(ledgerwriter.SOURCE_PREFIX)}
        self.assertEqual(sorted(mine.values()), [72, 144])
        self.assertEqual(mine[ledgerwriter.SOURCE_PREFIX + ledgerwriter.source_key("src-b", SALT)], 72)
        self.assertNotIn("src-", json.dumps(lines))


class WhatItDoesNotKnow(unittest.TestCase):
    def test_what_the_host_does_not_record_is_unknown_and_names_the_one_field(self):
        c = history()
        beat(c, 1)
        lines = day(c, 1)
        self.assertEqual((lines["surfaced_cleared"]["value"], lines["surfaced_cleared"]["unknown"]), (None, "field-absent"))
        self.assertIn("events row", lines["surfaced_cleared"]["needs"])
        for n in ("views", "events_missed"):
            self.assertEqual((lines[n]["value"], lines[n]["unknown"]), (None, "not-measurable"))
            self.assertTrue(lines[n]["needs"])

    def test_no_line_uses_a_retired_word_and_every_line_is_valid(self):
        c = history()
        beat(c, 1)
        event(c, D0 + DAY + 9, "approval")
        lines = day(c, 1)
        for n, rec in lines.items():
            self.assertIsNone(ledger.check(rec), n)
            self.assertIsNone(RETIRED.search(json.dumps(rec)), n)
        self.assertIsNone(RETIRED.search(ledgerwriter.NEEDS["views"] + ledgerwriter.NEEDS["events_missed"] + ledgerwriter.NEEDS["surfaced_cleared"]))


class TheFile(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "ledger", "weatherdeck.jsonl")
        self.addCleanup(self.tmp.cleanup)
        self.conn = history()
        for n in range(3):
            beat(self.conn, n)

    def write(self, **kw):
        return ledgerwriter.write(self.conn, kw.pop("now", NOW), self.path, kw.pop("host", "host-a"), LOST, salt=SALT, **kw)

    def raw(self):
        with open(self.path, "rb") as fh:
            return fh.read()

    def test_closed_days_are_appended_once_and_the_reader_reads_them(self):
        res = self.write()
        self.assertEqual((res["state"], res["days"]), ("written", 3))
        first = self.raw()
        parsed = ledger.parse(first.decode())
        self.assertEqual((parsed["skipped"], parsed["dangling"]), ([], []))
        self.assertEqual(self.write()["state"], "current")
        self.assertEqual(self.raw(), first)                       # a second run changes nothing
        beat(self.conn, 3)                                        # today is not closed: never written
        self.assertEqual(self.write()["state"], "current")
        r = ledger.read(self.path, D0 + 3 * DAY, tool="weatherdeck")
        self.assertEqual(r["verdict"]["reading"], "UNMEASURED")   # surfaced_cleared is not recorded: no keep or cut call
        self.assertEqual(r["counters"]["pushes_ok"]["value"], 432)
        self.assertEqual(r["counters"]["surfaced_cleared"]["unknown"], "field-absent")

    def test_a_later_day_is_appended_to_what_is_there_byte_for_byte(self):
        self.write()
        before = self.raw()
        beat(self.conn, 3)
        res = self.write(now=NOW + DAY)
        self.assertEqual((res["state"], res["days"]), ("written", 1))
        self.assertTrue(self.raw().startswith(before))

    def test_a_ledger_the_reader_cannot_read_is_left_exactly_as_it_is(self):
        os.makedirs(os.path.dirname(self.path))
        for name, blob in (("torn", b'{"v":1,"id":"a"}\n{"v":1,"i'), ("binary", b"\xff\xfe\x00 not a ledger\n"),
                           ("other tool", json.dumps({"v": 1, "id": "x", "tool": "doctor", "counter": "c", "host": "h", "reader": "r",
                                                      "window": {"from": 1, "to": 2}, "read_at": 3, "quality": "exact", "value": None,
                                                      "unknown": "field-absent", "coverage": {"rows": 0, "covers_window": 0.0}}).encode() + b"\n")):
            with open(self.path, "wb") as fh:
                fh.write(blob)
            self.assertEqual(self.write()["state"], "refused", name)
            self.assertEqual(self.raw(), blob, name)
        os.unlink(self.path)
        target = os.path.join(self.tmp.name, "elsewhere.jsonl")
        with open(target, "wb") as fh:
            fh.write(b"")
        os.symlink(target, self.path)
        self.assertEqual(self.write()["state"], "refused")
        self.assertEqual(open(target, "rb").read(), b"")

    def test_a_dry_run_creates_nothing(self):
        res = self.write(dry_run=True)
        self.assertEqual((res["state"], res["days"]), ("dry-run", 3))
        self.assertFalse(os.path.exists(os.path.dirname(self.path)))

    def test_a_host_with_no_push_yet_writes_nothing(self):
        res = ledgerwriter.write(history(), NOW, self.path, "host-a", LOST, salt=SALT)
        self.assertEqual(res["state"], "no-history")
        self.assertFalse(os.path.exists(self.path))

    def test_a_day_is_closed_only_after_the_grace_so_a_push_stamped_before_midnight_is_counted(self):
        self.assertEqual(self.write(now=D0 + 3 * DAY + ledgerwriter.GRACE - 1)["days"], 2)
        push(self.conn, "src-a", D0 + 3 * DAY - 1)           # stamped before midnight, committed after it
        self.write(now=D0 + 3 * DAY + ledgerwriter.GRACE)
        r = ledger.read(self.path, D0 + 3 * DAY, tool="weatherdeck")
        self.assertEqual(r["counters"]["pushes_ok"]["value"], 433)

    def test_a_capped_run_leaves_the_rest_for_the_next(self):
        res = self.write(max_days=2)
        self.assertEqual((res["state"], res["days"], res["more"]), ("written", 2, True))
        res = self.write(max_days=2)
        self.assertEqual((res["days"], res["more"]), (1, False))
        self.assertEqual(self.write(max_days=2)["state"], "current")

    def test_a_day_already_held_under_another_host_label_is_not_written_again(self):
        self.write()
        before = self.raw()
        self.assertEqual(self.write(host="host-b")["state"], "current")
        self.assertEqual(self.raw(), before)

    def test_the_card_shows_what_was_written(self):
        self.write()
        read = ledger.read(self.path, D0 + 3 * DAY, tool="weatherdeck")
        c = ledgercards.card("weatherdeck", "ok", read, NOW)
        self.assertEqual((c["status"], c["mode"]), ("unknown", "unmeasured"))
        shown = {n["label"]: n["value"] for n in c["numbers"]}
        self.assertEqual(shown["surfaced cleared"], "unknown: not recorded yet")
        self.assertEqual(shown["events missed"], "unknown: not measurable")


class TheInstall(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        saved = dict(config._state)
        self.addCleanup(config._state.update, saved)
        config.init(data_dir=self.tmp.name, config_path=os.path.join(self.tmp.name, "none.json"))

    def test_the_salt_is_created_once_private_and_stable(self):
        salt = ledgerwriter.install_salt()
        self.assertRegex(salt, r"^[0-9a-f]{64}$")
        self.assertEqual(ledgerwriter.install_salt(), salt)
        path = os.path.join(self.tmp.name, ledgerwriter.SALT_FILE)
        if os.name != "nt":
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
        self.assertEqual([n for n in os.listdir(self.tmp.name) if n.endswith(".tmp")], [])

    def test_two_installs_give_different_keys_for_the_same_source(self):
        with tempfile.TemporaryDirectory() as other:
            a, b = ledgerwriter.install_salt(self.tmp.name), ledgerwriter.install_salt(other)
        self.assertNotEqual(ledgerwriter.source_key("src-a", a), ledgerwriter.source_key("src-a", b))
        self.assertEqual(ledgerwriter.source_key("src-a", a), ledgerwriter.source_key("src-a", a))

    def test_a_renamed_host_keeps_its_label_and_does_not_rewrite_days(self):
        conn = history()
        for n in range(3):
            beat(conn, n)
        with mock.patch.object(ledgerwriter.socket, "gethostname", return_value="old-name"):
            self.assertEqual(ledgerwriter.run(conn, NOW, {})["days"], 3)
        label = ledgerwriter.kept_host()
        self.assertTrue(label.startswith("h"))
        beat(conn, 3)
        with mock.patch.object(ledgerwriter.socket, "gethostname", return_value="new-name"):
            res = ledgerwriter.run(conn, NOW + DAY, {"host": "set-later"})
        self.assertEqual((res["state"], res["days"]), ("written", 1))
        path = os.path.join(self.tmp.name, "ledger", "weatherdeck.jsonl")
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        lines = [json.loads(t) for t in text.splitlines()]
        self.assertEqual({r["host"] for r in lines}, {label})
        self.assertEqual(len({r["id"] for r in lines}), len(lines))
        self.assertNotIn(ledgerwriter.install_salt(), text)


if __name__ == "__main__":
    unittest.main()
