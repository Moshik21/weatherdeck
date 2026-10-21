"""Behavioural smoke tests through the public `weatherdeck` command only (no imports from src/).

    python3 -m unittest discover -s tests

Standard library only; runs the same on macOS, Linux and Windows.
"""
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEATHERDECK = [sys.executable, str(ROOT / "bin" / "weatherdeck")]
FEED = {
    "schema": "lookout.feed", "schema_version": "1.0",
    "source": {"id": "smoke-source"},
    "items": [{"id": "nightly", "title": "Nightly build", "state": "running"}],
}


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get_json(url):
    with urllib.request.urlopen(url, timeout=3) as resp:
        return json.loads(resp.read().decode())


def wait_healthy(port, proc=None, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc is not None and proc.poll() is not None:
            raise AssertionError(f"weatherdeck exited early with {proc.returncode}")
        try:
            return get_json(f"http://127.0.0.1:{port}/healthz")
        except OSError:
            time.sleep(0.2)
    raise AssertionError("host did not become healthy")


class WeatherdeckSmoke(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.data = self._tmp.name
        self.env = dict(os.environ, WEATHERDECK_DATA=self.data, PYTHONDONTWRITEBYTECODE="1")

    def weatherdeck(self, *args, stdin=None):
        return subprocess.run(WEATHERDECK + list(args), input=stdin, capture_output=True, text=True,
                              env=self.env, timeout=60)

    def test_run_demo_serves_synthetic_sources(self):
        port = free_port()
        proc = subprocess.Popen(WEATHERDECK + ["run", "--demo", "--port", str(port)], env=self.env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            self.assertTrue(wait_healthy(port, proc)["ok"])
            page = urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=3).read()
            self.assertIn(b"<html", page.lower())
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()

    def test_run_demo_without_config_does_not_serve_the_machine_hostname(self):
        port = free_port()
        proc = subprocess.Popen(WEATHERDECK + ["run", "--demo", "--port", str(port)], env=self.env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_healthy(port, proc)
            url = f"http://127.0.0.1:{port}/api/view"
            body = urllib.request.urlopen(url, timeout=3).read().decode()
            hostname = socket.gethostname().split(".")[0]
            self.assertNotEqual(json.loads(body)["server"]["host"], hostname)
            self.assertIsNone(re.search(rf"\b{re.escape(hostname)}\b", body, re.IGNORECASE))
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()

    def test_on_ingest_status_off(self):
        port = free_port()
        started = self.weatherdeck("on", "--port", str(port))
        self.assertEqual(started.returncode, 0, started.stdout + started.stderr)
        try:
            self.assertTrue(wait_healthy(port)["ok"])
            ingested = self.weatherdeck("ingest", stdin=json.dumps(FEED))
            self.assertEqual(ingested.returncode, 0, ingested.stdout + ingested.stderr)
            self.assertTrue(ingested.stdout.startswith("ok"), ingested.stdout)
            status = self.weatherdeck("status")
            self.assertEqual(status.returncode, 0, status.stderr)
            self.assertIn("running", status.stdout)
            self.assertIn("smoke-source", status.stdout)
        finally:
            stopped = self.weatherdeck("off")
        self.assertEqual(stopped.returncode, 0, stopped.stdout + stopped.stderr)
        self.assertIn("not running", self.weatherdeck("status").stdout)

    def test_ingest_rejects_garbage(self):
        bad = self.weatherdeck("ingest", stdin="this is not a feed")
        self.assertNotEqual(bad.returncode, 0)

    def test_ingest_rejects_null_members_and_non_finite_numbers_and_keeps_the_last_good_feed(self):
        good = self.weatherdeck("ingest", stdin=json.dumps(FEED))
        self.assertEqual(good.returncode, 0, good.stdout + good.stderr)
        stored = Path(self.data) / "sources" / "smoke-source.json"
        before = stored.read_text()
        machine = {"id": "box", "extras": [{"label": "temp", "value": "__NAN__"}]}
        for body in (dict(FEED, items=[None]),
                     dict(FEED, machines=[machine]),
                     dict(FEED, x_extension={"deep": [{"v": "__NAN__"}]})):
            bad = self.weatherdeck("ingest", stdin=json.dumps(body).replace('"__NAN__"', "NaN"))
            self.assertNotEqual(bad.returncode, 0, bad.stdout + bad.stderr)
            self.assertIn("rejected", bad.stdout + bad.stderr)
            self.assertEqual(stored.read_text(), before)


class SelfAudit(unittest.TestCase):
    def test_product_tree_is_clean(self):
        out = subprocess.run([sys.executable, str(ROOT / "scripts" / "self-audit"), str(ROOT)],
                             capture_output=True, text=True, timeout=120)
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)

    def test_builtin_list_flags_a_provider_name_without_a_denylist(self):
        for word in ("clau" + "de", "anthro" + "pic", "open" + "ai"):
            with self.subTest(word=word), tempfile.TemporaryDirectory() as tmp:
                (Path(tmp) / "notes.md").write_text(f"The board reads {word.title()} allowances.\n")
                out = subprocess.run([sys.executable, str(ROOT / "scripts" / "self-audit"), tmp],
                                     capture_output=True, text=True, timeout=60)
                self.assertEqual(out.returncode, 1, out.stdout + out.stderr)
                self.assertIn(word, out.stdout.lower())


if __name__ == "__main__":
    unittest.main()
