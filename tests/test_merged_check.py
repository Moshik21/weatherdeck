"""Behaviour of scripts/merged-check against scratch git repositories with synthetic fixtures.

    python3 -m unittest discover -s tests

Added with the script, for the one script only. Each scratch repository has a bare "origin" beside it, a copy of
scripts/self-audit and one trivial test, all in a temporary directory with an empty global git config. The audit
word is assembled at run time so this file stays clean for the self-audit.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECK = [sys.executable, str(ROOT / "scripts" / "merged-check")]
WORD = "zeb" + "ra"


@unittest.skipUnless(shutil.which("git"), "needs git")
class MergedCheck(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.scratch = base / "scratch-tmp"  # where merged-check makes its clone; must be empty again after a run
        self.scratch.mkdir()
        self.env = dict(os.environ, HOME=self.tmp.name, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1",
                        TMPDIR=str(self.scratch), GIT_AUTHOR_NAME="Ada", GIT_AUTHOR_EMAIL="ada@example.invalid",
                        GIT_COMMITTER_NAME="Ada", GIT_COMMITTER_EMAIL="ada@example.invalid")
        self.env.pop("MERGED_CHECK_DENYLIST", None)
        self.origin = base / "origin.git"
        self.repo = base / "repo"
        self.git("init", "-q", "--bare", "-b", "main", str(self.origin), cwd=base)
        self.git("clone", "-q", str(self.origin), str(self.repo), cwd=base)
        (self.repo / "scripts").mkdir()
        (self.repo / "tests").mkdir()
        shutil.copy(ROOT / "scripts" / "self-audit", self.repo / "scripts" / "self-audit")
        (self.repo / "tests" / "test_ok.py").write_text(
            "import unittest\n\nclass Ok(unittest.TestCase):\n    def test_ok(self):\n        pass\n", encoding="utf-8")
        (self.repo / "notes.md").write_text("one\ntwo\nthree\n", encoding="utf-8")
        self.git("add", "-A")
        self.commit("start")
        self.git("push", "-q", "origin", "HEAD:main")

    def git(self, *args, cwd=None):
        out = subprocess.run(["git", "-c", "commit.gpgsign=false", *args], cwd=cwd or self.repo, env=self.env,
                             capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        return out.stdout

    def commit(self, message):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)
        return self.git("rev-parse", "HEAD").strip()

    def branch(self, name, change):
        """A commit on `name`, made from the start of main, by `change(repo)`; returns its sha."""
        self.git("checkout", "-q", "-b", name, "origin/main")
        change(self.repo)
        sha = self.commit(name)
        self.git("checkout", "-q", "main")
        return sha

    def check(self, *args):
        return subprocess.run(CHECK + list(args), cwd=self.repo, env=self.env, capture_output=True, text=True, timeout=300)

    def new_rule(self, repo):
        audit = repo / "scripts" / "self-audit"
        text = audit.read_text(encoding="utf-8")
        head = "VENDOR = [w for w in ("  # prepend, so a name appended to the list later does not break this
        changed = text.replace(head, head + '"%s", ' % WORD, 1)
        self.assertNotEqual(text, changed)
        audit.write_text(changed, encoding="utf-8")

    def new_text(self, repo):
        with open(repo / "notes.md", "a", encoding="utf-8") as f:
            f.write("a %s walks past\n" % WORD)

    def test_each_branch_clean_alone_but_red_merged(self):
        rule = self.branch("rule", self.new_rule)
        text = self.branch("text", self.new_text)
        self.git("push", "-q", "origin", "rule:main")  # main moves to the new rule; the text branch was cut before it
        for alone, its_base in ((rule, rule + "~1"), (text, text + "~1")):
            out = self.check("--head", alone, "--base", its_base)
            self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
        out = self.check("--head", text)
        self.assertEqual(out.returncode, 1, out.stdout + out.stderr)
        self.assertRegex(out.stdout, r"^merged-check: FAILED self-audit: notes\.md:4: vendor-specific name\n$")
        self.assertNotIn(WORD, out.stdout)

    def test_conflicting_merge_names_the_files(self):
        self.branch("one", lambda r: (r / "notes.md").write_text("one\nTWO\nthree\n", encoding="utf-8"))
        two = self.branch("two", lambda r: (r / "notes.md").write_text("one\ntwo?\nthree\n", encoding="utf-8"))
        self.git("push", "-q", "origin", "one:main")
        out = self.check("--head", two)
        self.assertEqual(out.returncode, 1, out.stdout + out.stderr)
        self.assertEqual(out.stdout, "merged-check: FAILED merge: conflict in notes.md\n")

    def test_clean_merge_passes(self):
        self.branch("rule", self.new_rule)
        other = self.branch("other", lambda r: (r / "other.md").write_text("fine\n", encoding="utf-8"))
        self.git("push", "-q", "origin", "rule:main")
        out = self.check("--head", other)
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
        self.assertEqual(out.stdout, "merged-check: ok\n")

    def test_the_callers_repository_is_untouched_and_nothing_is_left_behind(self):
        self.branch("rule", self.new_rule)
        text = self.branch("text", self.new_text)
        self.git("push", "-q", "origin", "rule:main")
        self.git("checkout", "-q", "text")
        before = (self.git("rev-parse", "HEAD"), self.git("status", "--porcelain"), self.git("branch", "--list"))
        for head in (text, "HEAD"):
            self.assertEqual(self.check("--head", head).returncode, 1)
        self.assertEqual((self.git("rev-parse", "HEAD"), self.git("status", "--porcelain"), self.git("branch", "--list")), before)
        self.assertEqual(len(self.git("worktree", "list").splitlines()), 1)
        self.assertEqual(os.listdir(self.scratch), [])


if __name__ == "__main__":
    unittest.main()
