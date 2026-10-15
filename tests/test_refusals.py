"""Contract tests for what the host says about refused pushes (unreleased, onboarding slice 1).

    python3 -m unittest discover -s tests

Added under the same deliberate, narrow exception as tests/test_contract.py (CONTRIBUTING.md, "Tests"), for pure core logic only:
  - a refused ingest push (401, or the "no tokens yet" 403) is logged once per client address per 10 minutes
    (`note_refusal`, and the host's POST handler on a scratch port), with the last refusal per address kept in memory;
  - `weatherdeck token new` for the first push token names the loopback HTTP sources the received log shows from the last
    day (`ingest.loopback_http_sources`, `cli.cmd_token`).
Synthetic data only, standard library only; the host binds a scratch port on 127.0.0.1 and writes only to a temporary data directory.
"""
import argparse
import contextlib
import io
import json
import logging
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import cli, config, ingest, server  # noqa: E402

NOW = 1_800_000_000          # 2027-01-15T08:00:00Z, a fixed clock


def iso(t):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


class Scratch(unittest.TestCase):
    """A temporary data directory the config points at for the length of one test."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        saved = dict(config._state)
        self.addCleanup(config._state.update, saved)
        self.data = Path(self._tmp.name)
        config.init(data_dir=str(self.data), config_path=str(self.data / "config.json"))
        server._refusals.clear()
        self.addCleanup(server._refusals.clear)

    def write_received(self, *lines):
        with open(ingest.received_log_path(), "w", encoding="utf-8") as fh:
            for d in lines:
                fh.write(json.dumps(d) + "\n")


class RefusalRate(unittest.TestCase):
    def setUp(self):
        server._refusals.clear()
        self.addCleanup(server._refusals.clear)

    def test_one_line_per_address_per_ten_minutes(self):
        self.assertEqual(server.note_refusal("addr-a", 401, "x", now=NOW), 0)       # logged, nothing held back
        self.assertIsNone(server.note_refusal("addr-a", 401, "x", now=NOW + 5))      # not logged
        self.assertIsNone(server.note_refusal("addr-a", 401, "x", now=NOW + 599))
        self.assertEqual(server.note_refusal("addr-a", 401, "x", now=NOW + 600), 2)  # logged again, says two were held
        self.assertEqual(server.note_refusal("addr-a", 403, "y", now=NOW + 601 + 600), 0)

    def test_another_address_is_its_own_count(self):
        server.note_refusal("addr-a", 401, "x", now=NOW)
        self.assertEqual(server.note_refusal("addr-b", 403, "y", now=NOW + 1), 0)

    def test_last_refusal_per_address_is_kept_and_bounded(self):
        server.note_refusal("addr-a", 401, "first", now=NOW)
        server.note_refusal("addr-a", 403, "second", now=NOW + 1)
        self.assertEqual(server.last_refusals()["addr-a"], {"at": NOW + 1, "code": 403, "why": "second"})
        for i in range(server.REFUSALS_KEPT + 20):
            server.note_refusal(f"192.0.2.{i}", 401, "x", now=NOW)
        self.assertEqual(len(server.last_refusals()), server.REFUSALS_KEPT)


class RefusedPush(Scratch):
    def test_post_without_a_token_logs_once_then_stays_quiet(self):
        (self.data / "tokens.json").write_text(json.dumps({"tokens": {"beat-a": "0" * 64}}))
        records = []

        class Grab(logging.Handler):
            def emit(self, record):
                records.append(record)

        grab = Grab(level=logging.WARNING)
        logging.getLogger("weatherdeck.server").addHandler(grab)
        self.addCleanup(logging.getLogger("weatherdeck.server").removeHandler, grab)
        srv = server.Listener(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        url = f"http://127.0.0.1:{srv.server_address[1]}/api/ingest"

        def post(token=None):
            req = urllib.request.Request(url, data=b"{}", method="POST", headers={"Content-Type": "application/json"})
            if token:
                req.add_header("Authorization", "Bearer " + token)
            with self.assertRaises(urllib.error.HTTPError) as cm:
                urllib.request.urlopen(req, timeout=5)
            cm.exception.close()
            return cm.exception.code

        self.assertEqual(post(), 401)
        self.assertEqual(len(records), 1)
        text = records[0].getMessage()
        self.assertIn("from 127.0.0.1", text)
        self.assertIn("a valid bearer token is required", text)
        self.assertIn("no Authorization header", text)
        self.assertEqual(post("not-a-real-token"), 401)   # still refused, and not logged again within 10 minutes
        self.assertEqual(len(records), 1)
        self.assertNotIn("not-a-real-token", text)
        last = server.last_refusals()["127.0.0.1"]
        self.assertEqual((last["code"], last["why"]), (401, "a valid bearer token is required"))


class FirstTokenWarning(Scratch):
    def run_token(self, name):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            cli.cmd_token(argparse.Namespace(action="new", name=name, read=False))
        return out.getvalue()

    def test_names_loopback_http_sources_seen_in_the_last_day(self):
        now = time.time()
        self.write_received(
            {"at": iso(now - 60), "source": "beat-x", "transport": "http", "client": "127.0.0.1", "result": "ok"},
            {"at": iso(now - 30), "source": "remote-y", "transport": "http", "client": "2001:db8::9", "result": "ok"},
            {"at": iso(now - 30), "source": "ssh-z", "transport": "stdin", "result": "ok"},
            {"at": iso(now - 30), "source": "old-w", "transport": "http", "result": "ok"},                # logged before `client`
            {"at": iso(now - 2 * 86400), "source": "stale-v", "transport": "http", "client": "127.0.0.1", "result": "ok"})
        out = self.run_token("beat-new")
        self.assertIn("this is the first push token", out)
        self.assertIn("beat-x", out)
        for other in ("remote-y", "ssh-z", "old-w", "stale-v"):
            self.assertNotIn(other, out)

    def test_says_when_none_were_seen(self):
        out = self.run_token("beat-new")
        self.assertIn("this is the first push token", out)
        self.assertIn("no loopback HTTP source was seen", out)

    def test_only_the_first_token_warns_and_the_token_is_still_printed_once(self):
        self.run_token("beat-new")
        out = self.run_token("beat-second")
        self.assertNotIn("first push token", out)
        self.assertIn("token for source beat-second", out)


if __name__ == "__main__":
    unittest.main()
