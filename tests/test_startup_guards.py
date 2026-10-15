"""The refusals a stranger meets first: an old Python, a port out of range, and `pip install`.

    python3 -m unittest tests.test_startup_guards
"""
import contextlib
import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

import pip_not_supported  # noqa: E402
import weatherdeck  # noqa: E402


class StartupGuards(unittest.TestCase):
    def test_old_python_is_refused_in_one_plain_sentence(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as cm:
            weatherdeck.require_python((3, 8, 20))
        self.assertEqual(cm.exception.code, 2)
        self.assertEqual(err.getvalue(), "weatherdeck: needs Python 3.9 or newer, and this is Python 3.8.20.\n")

    def test_supported_python_passes(self):
        weatherdeck.require_python((3, 9, 0))
        weatherdeck.require_python(sys.version_info)

    def test_port_out_of_range_is_a_plain_message(self):
        for port in ("99999", "0", "-5"):
            with tempfile.TemporaryDirectory() as data:
                out = subprocess.run([sys.executable, str(ROOT / "bin" / "weatherdeck"), "--data", data, "run", "--port", port],
                                     capture_output=True, text=True, timeout=30)
            self.assertEqual(out.returncode, 2, out.stderr)
            self.assertEqual(out.stderr, f"weatherdeck: --port must be a whole number from 1 to 65535 (got {port}).\n")

    def test_config_port_out_of_range_is_a_plain_message(self):
        with tempfile.TemporaryDirectory() as data:
            cfg = Path(data) / "config.json"
            cfg.write_text('{"hosts": {"port": 99999}}')
            out = subprocess.run([sys.executable, str(ROOT / "bin" / "weatherdeck"), "--data", data, "--config", str(cfg), "run"],
                                 capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 2, out.stderr)
        self.assertEqual(out.stderr, "weatherdeck: hosts.port in the config must be a whole number from 1 to 65535 (got 99999).\n")

    def test_pip_build_refuses_with_the_reason(self):
        for hook in ("get_requires_for_build_wheel", "build_wheel", "build_editable", "build_sdist"):
            with self.assertRaises(RuntimeError) as cm:
                getattr(pip_not_supported, hook)()
            self.assertIn("cannot be installed with pip yet", str(cm.exception))
            self.assertIn("bin/weatherdeck run --demo", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
