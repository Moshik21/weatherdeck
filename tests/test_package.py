"""scripts/build-package makes the product zip and nothing else, and that zip carries the community files its documents link: contract only.

    python3 -m unittest discover -s tests
"""
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ProductZip(unittest.TestCase):
    def test_community_files_linked_by_contributing_are_in_the_zip(self):
        with tempfile.TemporaryDirectory() as out:
            subprocess.run([sys.executable, str(ROOT / "scripts" / "build-package"), "--out", out], check=True, capture_output=True)
            ver = re.search(r'VERSION = "([^"]+)"', (ROOT / "src" / "weatherdeck" / "__init__.py").read_text()).group(1)
            self.assertEqual(sorted(p.name for p in Path(out).iterdir()), [f"weatherdeck-{ver}.zip"], "build-package makes the product zip only")
            z = Path(out) / f"weatherdeck-{ver}.zip"
            names = set(zipfile.ZipFile(z).namelist())
            top = z.stem
            text = (ROOT / "CONTRIBUTING.md").read_text()
            for link in sorted(set(re.findall(r"\]\(([A-Z_]+\.md)\)", text))):
                self.assertIn(f"{top}/{link}", names, f"{z.name} lacks {link}, which CONTRIBUTING.md links")


if __name__ == "__main__":
    unittest.main()
