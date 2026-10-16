"""Acceptance test for how a silent feed reads: silent, not down, and the machine said only as far as its beat shows it.

    python3 -m unittest discover -s tests

Added under the same deliberate, narrow exception as tests/test_housekeeping.py (CONTRIBUTING.md, "Tests"), as a task brief's named
acceptance test, for the host's two derived view fields (`src/weatherdeck/view.py`: a source's `interval_declared`, a machine's
`beat_seen`) and the page's pure wording rule (`web/frontdoor.js` `sourceSaying`, run in Node over the host's own view, with the
machine row and the trust line it feeds). Synthetic sources and machines go in through the public ingest, each with the receive time
the case needs, into a temporary data directory. The cases: a silent feed with a fresh beat, with no beat ever, and with a stale beat;
a declared 20 s interval at 1.5x, 3x and 10x; no declared interval. Standard library only, no network; the page half runs in Node when
Node is installed and is skipped otherwise.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
NOW = int(time.time())
DEFAULTS = json.loads((ROOT / "src" / "weatherdeck" / "defaults.json").read_text(encoding="utf-8"))
WORDS = DEFAULTS["labels"]

INGEST = ("import json, sys; from weatherdeck import ingest\n"
          "for raw, at in json.load(sys.stdin):\n"
          "    out = ingest.ingest(json.dumps(raw).encode(), received_at=at)\n"
          "    assert out.code == 0, out\n"
          "from weatherdeck import view\n"
          "json.dump(view.build(now=float(sys.argv[1])), sys.stdout)")

# The page's own scripts in one context (as tests/test_housekeeping.py does), asked for what the silent source and its machine say.
# The data goes in on stdin, not argv (Windows refuses a command line over 32767 characters), and the answer is read as UTF-8 (not the code page).
PAGE = r"""
const vm = require("vm"), fs = require("fs");
const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub });
const store = {}, localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
const ctx = vm.createContext({ localStorage, performance: { now: () => 0 }, document: stub, window: stub, navigator: stub, addEventListener: stub, location: stub, console, Date, Math, JSON, Intl });
for (const f of ["theme.js", "frontdoor.js", "model.js", "board.js", "decks.js", "page.js"]) vm.runInContext(fs.readFileSync(process.argv[1] + "/web/" + f, "utf8"), ctx, { filename: f });
vm.runInContext(`globalThis.run = (view, labels, display, thresholds, now) => {
  S.srv0 = now; S.p0 = 0; S.view = view; S.theme = { components: {}, zones: {} };
  S.server = { config: { labels, theme: {}, display, thresholds, poll: {}, sound: {} } };
  const B = boardModel({ phone: false }), trust = trustLine(B);
  return { say: Object.fromEntries(view.sources.map(s => [s.id, sourceSay(s)])), levels: Object.fromEntries(view.sources.map(s => [s.id, srcLevel(s)])),
    vitals: Object.fromEntries(B.machines.map(m => [m.id, m.vitals.map(v => v.text)])), words: Object.fromEntries(B.machines.map(m => [m.id, m.word])),
    problems: trust.problems };
};`, ctx);
process.stdout.write(JSON.stringify(ctx.run(...JSON.parse(fs.readFileSync(0, "utf8")))));
"""


def feed(sid, machine, interval=None, beat=None, seq=1):
    doc = {"schema": "lookout.feed", "schema_version": "1.8", "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(NOW)),
           "source": {"id": sid, "machine": machine, "kind": "standalone" if beat else "adapter"}, "items": [], "attention": [],
           "producer": {"boot_id": "boot-" + sid, "seq": seq}}
    if interval:
        doc["interval_s"] = interval
    if beat:
        doc["machines"] = [{"id": machine, "label": machine, "status": "ok", "beat": beat}]
    return doc


def build(pushes):
    """pushes: [(feed, seconds before NOW it was received)] -> the host's view at NOW."""
    with tempfile.TemporaryDirectory() as tmp:
        env = dict(os.environ, WEATHERDECK_DATA=tmp, PYTHONDONTWRITEBYTECODE="1", PYTHONPATH=str(ROOT / "src"))
        out = subprocess.run([sys.executable, "-c", INGEST, str(NOW)], input=json.dumps([[f, NOW - ago] for f, ago in pushes]),
                             capture_output=True, text=True, env=env, timeout=60)
        assert out.returncode == 0, out.stderr
        return json.loads(out.stdout)


def page(view):
    out = subprocess.run([NODE, "-e", PAGE, str(ROOT)], input=json.dumps([view, WORDS, DEFAULTS["display"], DEFAULTS["thresholds"], NOW]),
                         capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def beat(age_s=0, interval_s=15):
    return {"seq": 1, "interval_s": interval_s, "age_s": age_s}


def fleet():
    """atlas: its pusher silent 400 s (declared 20 s), a beat source fresh 8 s. borealis: the same pusher, no beat ever.
    cinder: the pusher and the beat both silent 1200 s. The declared 20 s interval at 1.5x, 3x and 10x, on three machines.
    host-a: no declared interval, at 200 s and at 90 s."""
    return [
        (feed("atlas-pusher", "atlas", 20), 400), (feed("beat-atlas", "atlas", 15, beat()), 8),
        (feed("borealis-pusher", "borealis", 20), 400),
        (feed("cinder-pusher", "cinder", 20), 1200), (feed("beat-cinder", "cinder", 15, beat()), 1200),
        (feed("pace-live", "m-live", 20, beat(0, 20)), 30), (feed("pace-late", "m-late", 20), 60), (feed("pace-silent", "m-silent", 20), 200),
        (feed("plain-silent", "host-a"), 200), (feed("plain-late", "host-b"), 90),
    ]


class HostFields(unittest.TestCase):
    """The host's half: what is declared, and when a machine was last seen through a beat. Derived, never a new feed field."""

    @classmethod
    def setUpClass(cls):
        cls.view = build(fleet())
        cls.src = {s["id"]: s for s in cls.view["sources"]}
        cls.mach = {m["id"]: m for m in cls.view["machines"]}

    def test_a_source_says_whether_its_interval_is_its_own_word(self):
        self.assertTrue(self.src["atlas-pusher"]["interval_declared"])
        self.assertFalse(self.src["plain-silent"]["interval_declared"])
        self.assertEqual(self.src["plain-silent"]["interval_s"], DEFAULTS["thresholds"]["default_interval_s"])   # the default stands in, said so

    def test_a_machine_says_when_its_beat_last_sampled_it(self):
        seen = self.mach["atlas"]["beat_seen"]
        self.assertEqual(seen["at"], time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(NOW - 8)))
        self.assertEqual(seen["interval_s"], 15)
        self.assertEqual(self.mach["cinder"]["beat_seen"]["at"], time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(NOW - 1200)))

    def test_a_machine_no_beat_ever_sampled_has_none_not_zero(self):
        self.assertIsNone(self.mach["borealis"]["beat_seen"])


@unittest.skipUnless(NODE, "Node is not installed: the page half is not run")
class PageWords(unittest.TestCase):
    """The page's half: silent in the order of evidence, never down or missing without it, thresholds in the words."""

    @classmethod
    def setUpClass(cls):
        cls.got = page(build(fleet()))
        cls.say = cls.got["say"]

    def test_a_silent_feed_with_a_fresh_beat_says_the_machine_was_seen_through_it(self):
        self.assertEqual(self.say["atlas-pusher"]["line"], "Silent for 6 min (missing after 4 x 20 s), machine last seen 8 s ago via its beat")
        self.assertEqual(self.say["atlas-pusher"]["evidence"], "beat")
        self.assertEqual(self.say["atlas-pusher"]["seenS"], 8)

    def test_a_silent_feed_with_no_beat_ever_says_the_machine_was_not_seen(self):
        self.assertEqual(self.say["borealis-pusher"]["line"], "Silent for 6 min (missing after 4 x 20 s), machine not seen")
        self.assertEqual(self.say["borealis-pusher"]["evidence"], "none")
        self.assertIsNone(self.say["borealis-pusher"]["seenS"])

    def test_a_silent_feed_with_a_stale_beat_says_not_seen_since_then_and_not_down(self):
        s = self.say["cinder-pusher"]
        self.assertEqual(s["line"], "Silent for 20 min (missing after 4 x 20 s), machine not seen for 20 min, its beat is silent too")
        self.assertEqual(s["evidence"], "old-beat")

    def test_declared_20_s_at_1_5x_3x_and_10x(self):
        self.assertEqual(self.got["levels"]["pace-live"], "live")
        self.assertIsNone(self.say["pace-live"]["line"])                     # 30 s: on time, nothing to say
        self.assertEqual(self.say["pace-late"]["line"], "Late 1 min (missing after 4 x 20 s)")   # 60 s: three intervals, late with its age
        self.assertEqual(self.say["pace-late"]["kind"], "late")
        self.assertEqual(self.say["pace-silent"]["line"], "Silent for 3 min (missing after 4 x 20 s), machine not seen")   # ten intervals
        self.assertEqual(self.say["pace-silent"]["kind"], "silent")

    def test_no_declared_interval_is_said_and_never_missing(self):
        self.assertEqual(self.say["plain-silent"]["line"], "Silent for 3 min (interval not declared), machine not seen")
        self.assertEqual(self.say["plain-late"]["line"], "Last push 1 min ago (interval not declared)")
        for sid in ("plain-silent", "plain-late"):
            self.assertNotIn("missing", self.say[sid]["line"].lower(), sid)

    def test_no_line_calls_a_machine_down_or_missing_on_silence_alone(self):
        for sid, s in self.say.items():
            for word in ("down", "lost"):
                self.assertNotIn(word, (s["line"] or "").lower(), sid)
            if s["kind"] == "silent":
                self.assertIn("machine", s["machine"], sid)

    def test_the_machine_row_and_the_trust_line_say_it_too(self):
        self.assertIn("Machine last seen 8 s ago via its beat", self.got["vitals"]["atlas"])
        self.assertIn("Machine not seen", self.got["vitals"]["borealis"])
        self.assertTrue(any("Machine not seen for 20 min" in v for v in self.got["vitals"]["cinder"]), self.got["vitals"]["cinder"])
        self.assertIn("atlas-pusher silent 6 min, machine last seen 8 s ago via its beat", self.got["problems"])
        self.assertTrue(self.got["words"]["atlas"].startswith("Silent"), self.got["words"]["atlas"])    # the machine word itself is unchanged


if __name__ == "__main__":
    unittest.main()
