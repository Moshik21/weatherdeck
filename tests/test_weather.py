"""Contract tests for the weather-transition rule (web/weather.js), added under the owner's narrow exception for pure core
logic (CONTRIBUTING.md): synthetic machine maps, standard library only, no network. The file is plain JavaScript; its tests
run it in Node when Node is installed, and are skipped otherwise."""
import json
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
NODE = shutil.which("node")
HARNESS = r"""
const s = require(process.argv[1]);
const out = {};
for (const [k, f] of Object.entries(JSON.parse(process.argv[2]))) out[k] = s[f.fn](...f.args);
process.stdout.write(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "Node is not installed: the weather rule is not run")
class Weather(unittest.TestCase):
    def run_js(self, calls):
        out = subprocess.run([NODE, "-e", HARNESS, str(ROOT / "web" / "weather.js"), json.dumps(calls)],
                             capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)

    def changes(self, prev, cur):
        return self.run_js({"r": {"fn": "weatherChanges", "args": [prev, cur]}})["r"]

    def test_a_real_change_triggers_once(self):
        self.assertEqual(self.changes({"a": "clear"}, {"a": "rain"}), {"a": {"from": "clear", "to": "rain"}})
        self.assertEqual(self.changes({"a": "rain"}, {"a": "rain"}), {})

    def test_first_load_and_same_value_never(self):
        self.assertEqual(self.changes(None, {"a": "rain"}), {})
        self.assertEqual(self.changes({"a": "clear", "b": "storm"}, {"a": "clear", "b": "storm"}), {})

    def test_reduced_motion_is_instant(self):
        r = self.run_js({"r": {"fn": "weatherChanges", "args": [{"a": "clear"}, {"a": "rain"}, True]}})["r"]
        self.assertEqual(r, {})

    def test_unknown_and_new_machines_never(self):
        self.assertEqual(self.changes({"a": None}, {"a": "rain"}), {})
        self.assertEqual(self.changes({"a": "rain"}, {"a": None}), {})
        self.assertEqual(self.changes({}, {"a": "rain"}), {})

    def test_only_a_known_verdict_is_tracked(self):
        keys = ["ok", "warn", "down", "alert", "silent", "lost", "unknown", "asleep", "maintenance"]
        r = self.run_js({k: {"fn": "weatherTracked", "args": [k]} for k in keys})
        self.assertEqual(r, {"ok": "clear", "warn": "rain", "down": "squall", "alert": "storm", "silent": None, "lost": None,
                             "unknown": None, "asleep": None, "maintenance": None})

    def test_draw_runs_four_steps_then_rests(self):
        ev = {"from": "clear", "to": "rain"}
        steps = self.run_js({str(i): {"fn": "weatherShape", "args": ["rain", ev, i]} for i in range(5)})
        self.assertEqual([steps[str(i)]["grow"] for i in range(5)], [0, 0.25, 0.5, 0.75, 1])
        back = self.run_js({str(i): {"fn": "weatherShape", "args": ["clear", {"from": "rain", "to": "clear"}, i]} for i in range(5)})
        self.assertEqual([(back[str(i)]["word"], back[str(i)]["grow"]) for i in range(5)],
                         [("rain", 1), ("rain", 0.75), ("rain", 0.5), ("rain", 0.25), ("clear", 0)])

    def test_no_event_or_a_stale_one_is_the_final_picture(self):
        r = self.run_js({"none": {"fn": "weatherShape", "args": ["rain", None, 4]}, "still": {"fn": "weatherShape", "args": ["rain", None, 0]},
                         "stale": {"fn": "weatherShape", "args": ["squall", {"from": "clear", "to": "rain"}, 1]},
                         "cut": {"fn": "weatherShape", "args": ["squall", {"from": "rain", "to": "squall"}, 1]}})
        for k in ("none", "still", "stale", "cut"):
            self.assertEqual(r[k]["grow"], 1)


if __name__ == "__main__":
    unittest.main()
