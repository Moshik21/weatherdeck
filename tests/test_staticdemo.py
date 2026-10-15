"""The static demo build (scripts/build-static-demo) on its recorded synthetic feed: contract only.

    python3 -m unittest discover -s tests
"""
import importlib.machinery
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    loader = importlib.machinery.SourceFileLoader(name.replace("-", "_"), str(ROOT / "scripts" / name))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


class StaticDemo(unittest.TestCase):
    def test_build_is_labelled_and_passes_the_audit(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "site"
            load("build-static-demo").build(out)
            page = (out / "index.html").read_text()
            self.assertIn("DEMO: recorded synthetic feed", page)
            for name in ("demo-feed.js", "demo-files.js", "demo.js", "demo.css"):
                self.assertTrue((out / name).is_file(), name)
            audit = subprocess.run([sys.executable, str(ROOT / "scripts" / "self-audit"), str(out)], capture_output=True, text=True)
            self.assertEqual(audit.returncode, 0, audit.stdout)

    def test_build_refuses_to_delete_a_folder_that_is_not_a_demo_build(self):
        build = load("build-static-demo").build
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "site"
            out.mkdir()
            (out / "keep.txt").write_text("mine")
            with self.assertRaises(SystemExit):
                build(out)
            self.assertTrue((out / "keep.txt").is_file())
            (out / "keep.txt").unlink()
            build(out)
            build(out)
            self.assertTrue((out / "demo-feed.js").is_file())

    def test_recording_is_synthetic_frames(self):
        doc = json.loads((ROOT / "examples" / "static-demo" / "recorded-feed.json").read_text())
        self.assertGreaterEqual(len(doc["frames"]), 2)
        for frame in doc["frames"]:
            self.assertEqual(frame["server"]["host"], "demo host")
            self.assertTrue(all(s["id"] for s in frame["view"]["sources"]))


if __name__ == "__main__":
    unittest.main()
