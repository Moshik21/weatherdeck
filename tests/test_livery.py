"""Contract tests for the per-machine livery rule (web/livery.js), added under the owner's narrow exception for pure core
logic (CONTRIBUTING.md): synthetic ids, standard library only, no network. The file is plain JavaScript; its tests run it
in Node when Node is installed, and are skipped otherwise."""
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
TONES = ["a", "b", "c", "d", "e", "f"]


@unittest.skipUnless(NODE, "Node is not installed: the livery rule is not run")
class Livery(unittest.TestCase):
    def run_js(self, calls):
        out = subprocess.run([NODE, "-e", HARNESS, str(ROOT / "web" / "livery.js"), json.dumps(calls)],
                             capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)

    def test_fnv1a_known_values(self):
        r = self.run_js({"empty": {"fn": "liveryHash", "args": [""]}, "a": {"fn": "liveryHash", "args": ["a"]},
                         "foobar": {"fn": "liveryHash", "args": ["foobar"]}})
        self.assertEqual(r, {"empty": 0x811C9DC5, "a": 0xE40C292C, "foobar": 0xBF9CF968})

    def test_a_machine_keeps_its_tone_and_there_are_six(self):
        ids = ["m%d" % i for i in range(200)]
        calls = {i: {"fn": "liveryIndex", "args": [i]} for i in ids}
        first, again = self.run_js(calls), self.run_js(calls)
        self.assertEqual(first, again)
        self.assertEqual(set(first.values()), set(range(6)))

    def test_no_id_no_livery_and_no_state_input(self):
        r = self.run_js({"none": {"fn": "liveryTone", "args": [None, TONES]}, "blank": {"fn": "liveryTone", "args": ["", TONES]},
                         "five": {"fn": "liveryTone", "args": ["x", TONES[:5]]}, "idx": {"fn": "liveryIndex", "args": ["x"]},
                         "tone": {"fn": "liveryTone", "args": ["x", TONES]}})
        self.assertIsNone(r["none"])
        self.assertIsNone(r["blank"])
        self.assertIsNone(r["five"])
        self.assertEqual(r["tone"], TONES[r["idx"]])

    def test_an_escort_has_no_stripe_and_a_larger_pennant(self):
        r = self.run_js({"flagship": {"fn": "liveryMarks", "args": ["flagship"]},
                         "escort": {"fn": "liveryMarks", "args": ["escort"]}})
        self.assertEqual(r["flagship"], {"stripe": True, "pennant": 4})
        self.assertFalse(r["escort"]["stripe"])
        self.assertGreater(r["escort"]["pennant"], r["flagship"]["pennant"])


if __name__ == "__main__":
    unittest.main()
