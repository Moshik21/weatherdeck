"""Contract tests for what the machine beat records about its own push (unreleased, beat 1.2).

    python3 -m unittest discover -s tests

Added under the same deliberate, narrow exception as tests/test_contract.py (CONTRIBUTING.md, "Tests") for the beat's pure
push logic only: the `push` key of the beat file (`bin/weatherdeck-beat` `Pusher`, `deliver`) and how often a push that stays
down is said in the log. Synthetic data only, standard library only; the only network is a stub host on a scratch loopback
port started and stopped inside the test, and the clock is injected. Nothing here samples a real machine's pressure rules.
"""
import importlib.machinery
import importlib.util
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
_PATH = str(ROOT / "bin" / "weatherdeck-beat")
_SPEC = importlib.util.spec_from_loader("weatherdeck_beat_under_test", importlib.machinery.SourceFileLoader("weatherdeck_beat_under_test", _PATH))
wb = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(wb)

T0 = 1_800_000_000  # 2027-01-15T08:00:00Z, a fixed clock


class Clock:
    def __init__(self, t=T0):
        self.t = t

    def __call__(self):
        return self.t


def stub_host(code, body):
    """A host that answers every ingest with `code` and `body`; returns (server, url)."""
    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers.get("Content-Length") or 0))
            self.send_response(code)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, "http://127.0.0.1:%d" % server.server_address[1]


class BeatPush(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        env = mock.patch.dict(os.environ, {"HOME": self.tmp.name, "XDG_CACHE_HOME": self.tmp.name}, clear=False)
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("WEATHERDECK_TOKEN", None)
        self.lines = []
        self.clock = Clock()

    def beat_for(self, url):
        out = os.path.join(self.tmp.name, "beat.json")
        o = wb.options(["run", "--machine", "lab", "--out", out, "--history-dir", "none", "--push", url])
        return wb.Beat(o), wb.Pusher(o, clock=self.clock), out

    def sample(self, beat, pusher, out):
        """One sample as `run` does it: take, push and record, write the file. Returns the beat file as read back."""
        doc, *_ = beat.take()
        wb.deliver(doc, pusher, self.lines.append)
        wb.write_atomic(out, json.dumps(doc, separators=(",", ":")))
        with open(out, encoding="utf-8") as fh:
            return json.load(fh)

    def test_a_host_answering_401_is_in_the_beat_file_within_one_sample(self):
        server, url = stub_host(401, b"a valid bearer token is required\n")
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        beat, pusher, out = self.beat_for(url)
        doc = self.sample(beat, pusher, out)
        self.assertEqual(doc["push"], {"state": "refused", "since": wb.iso(T0), "code": 401,
                                       "reason": "HTTP 401 a valid bearer token is required"})
        self.assertEqual(len(self.lines), 1)
        self.assertIn("refused the beat: HTTP 401 a valid bearer token is required", self.lines[0])

    def test_the_log_says_it_once_then_again_after_the_hour(self):
        server, url = stub_host(401, b"a valid bearer token is required\n")
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        beat, pusher, out = self.beat_for(url)
        self.sample(beat, pusher, out)
        for minutes in (1, 15, 59):
            self.clock.t = T0 + 60 * minutes
            self.sample(beat, pusher, out)
        self.assertEqual(len(self.lines), 1, "once per outage until the hour is up")
        self.clock.t = T0 + 3600
        doc = self.sample(beat, pusher, out)
        self.assertEqual(len(self.lines), 2)
        self.assertIn("still refused the beat: HTTP 401", self.lines[1])
        self.assertIn("since " + wb.iso(T0), self.lines[1])
        self.assertEqual(doc["push"]["since"], wb.iso(T0), "since is when the state began, not the last sample")
        self.clock.t = T0 + 3600 + 600
        self.sample(beat, pusher, out)
        self.assertEqual(len(self.lines), 2, "the hour restarts from the repeat")
        self.clock.t = T0 + 7200
        self.sample(beat, pusher, out)
        self.assertEqual(len(self.lines), 3)

    def test_no_host_is_down_with_no_code(self):
        server, url = stub_host(200, b"")
        server.shutdown()
        server.server_close()  # the port is now closed
        beat, pusher, out = self.beat_for(url)
        doc = self.sample(beat, pusher, out)
        self.assertEqual(doc["push"]["state"], "down")
        self.assertIsNone(doc["push"]["code"])
        self.assertTrue(doc["push"]["reason"].startswith("unreachable: "))

    def test_a_server_error_is_down_with_its_code_and_recovery_is_said_once(self):
        server, url = stub_host(503, b"busy")
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        beat, pusher, out = self.beat_for(url)
        doc = self.sample(beat, pusher, out)
        self.assertEqual((doc["push"]["state"], doc["push"]["code"]), ("down", 503))
        ok, ok_url = stub_host(200, b"{}")
        self.addCleanup(ok.server_close)
        self.addCleanup(ok.shutdown)
        pusher.o.push = ok_url
        self.clock.t = T0 + 30
        doc = self.sample(beat, pusher, out)
        self.assertEqual(doc["push"], {"state": "ok", "since": wb.iso(T0 + 30), "code": None, "reason": None})
        self.assertEqual(len(self.lines), 2)
        self.assertIn("accepts beats again", self.lines[1])
        self.clock.t = T0 + 60
        self.sample(beat, pusher, out)
        self.assertEqual(len(self.lines), 2)

    def test_without_push_the_file_has_no_push_key(self):
        out = os.path.join(self.tmp.name, "beat.json")
        o = wb.options(["run", "--machine", "lab", "--out", out, "--history-dir", "none"])
        doc, *_ = wb.Beat(o).take()
        wb.deliver(doc, None, self.lines.append)
        self.assertNotIn("push", doc)

    def test_a_reader_of_the_beat_file_still_gets_the_machine_row(self):
        server, url = stub_host(401, b"a valid bearer token is required\n")
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        beat, pusher, out = self.beat_for(url)
        doc = self.sample(beat, pusher, out)
        self.assertEqual(doc["schema"], "lookout.beat")
        self.assertEqual(doc["schema_version"], "1.0")
        self.assertEqual(doc["machine"]["id"], "lab")
        self.assertNotIn("push", doc["machine"], "the push state is the file's, not the machine row's")


if __name__ == "__main__":
    unittest.main()
