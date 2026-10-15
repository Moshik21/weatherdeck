"""examples/host/config.example.json, the config the host guide starts from, loads through the config loader.

    python3 -m unittest tests.test_hostexample
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import config, hostinfo, view  # noqa: E402

EXAMPLE = ROOT / "examples" / "host" / "config.example.json"


def paths(doc, prefix=()):
    """Every key path of a config, stopping at the maps whose keys are the user's own names."""
    free = {("machines", "aliases"), ("theme", "group_colors"), ("labels",)}
    for key, value in doc.items():
        here = prefix + (key,)
        if isinstance(value, dict) and here not in free:
            yield from paths(value, here)
        else:
            yield here


class HostExample(unittest.TestCase):
    def setUp(self):
        saved = dict(config._state)
        self.addCleanup(config._state.update, saved)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        config.init(data_dir=tmp.name, config_path=str(EXAMPLE))
        self.cfg = config.get()

    def test_it_loads_over_the_defaults(self):
        self.assertEqual(self.cfg["hosts"]["port"], 8787)
        self.assertEqual(self.cfg["hosts"]["label"], "My PC")
        self.assertEqual(self.cfg["theme"]["name"], "ship-deck")
        self.assertEqual(self.cfg["display"]["may_sleep"], ["laptop"])
        self.assertIn("full", self.cfg["profiles"])      # a key the example does not set still comes from the defaults

    def test_every_key_is_one_the_defaults_know(self):
        defaults = json.loads((ROOT / "src" / "weatherdeck" / "defaults.json").read_text(encoding="utf-8"))
        known = set(paths(defaults)) | {("machines", "aliases")}
        for path in paths(json.loads(EXAMPLE.read_text(encoding="utf-8"))):
            self.assertIn(path, known, "the example sets %s, which the host ignores" % ".".join(path))

    def test_the_bind_entries_are_accepted_and_name_real_profiles(self):
        entries = hostinfo.normalize(self.cfg["hosts"]["bind"], list(self.cfg["profiles"]))
        self.assertEqual([e["address"] for e in entries], ["localhost", "auto:10.8.0.0/24", "auto:192.168.1.0/24"])
        self.assertEqual([e["profiles"] for e in entries], [None, ["full"], ["tv"]])
        addrs, _waiting = hostinfo.resolve(self.cfg["hosts"]["bind"], list(self.cfg["profiles"]))
        self.assertEqual(addrs["127.0.0.1"], None)       # localhost serves every view

    def test_the_alias_folds_an_old_id_into_a_station(self):
        self.assertEqual(view.machine_aliases(self.cfg), {"my-pc-linux": ("my-pc", "Linux (WSL)")})

    def test_the_example_names_no_one(self):
        text = EXAMPLE.read_text(encoding="utf-8").lower()
        for word in ("tower", "captain", "mate", "100.64."):
            self.assertNotIn(word, text)


if __name__ == "__main__":
    unittest.main()
