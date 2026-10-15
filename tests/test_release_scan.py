"""Behaviour of scripts/release-scan against scratch git repositories with synthetic hits.

    python3 -m unittest discover -s tests

Added at the owner's request, for the one script only. The hits are assembled at run time so this file stays clean
for the self-audit; the scratch repositories live in a temporary directory with an empty global git config.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCAN = [sys.executable, str(ROOT / "scripts" / "release-scan")]
GOOD = ("Ada Author", "ada@example.invalid")
STRANGER = ("Zed Stranger", "zed@example.invalid")
TOKEN = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6"
HOME_PATH = "/home/" + "zedhome" + "/project"
DENIED = "quokkaword"


@unittest.skipUnless(shutil.which("git"), "needs git")
class ReleaseScan(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name) / "repo"
        self.repo.mkdir()
        self.env = dict(os.environ, HOME=self.tmp.name, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")
        self.git("init", "-q", "-b", "main")

    def git(self, *args, who=GOOD, cwd=None):
        env = dict(self.env, GIT_AUTHOR_NAME=who[0], GIT_AUTHOR_EMAIL=who[1],
                   GIT_COMMITTER_NAME=who[0], GIT_COMMITTER_EMAIL=who[1])
        out = subprocess.run(["git", "-c", "commit.gpgsign=false", *args], cwd=cwd or self.repo, env=env,
                             capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        return out

    def commit(self, name, text, who=GOOD):
        (self.repo / name).write_text(text, encoding="utf-8")
        self.git("add", name, who=who)
        self.git("commit", "-q", "-m", "change " + name, who=who)

    def scan(self, *args, repo=None):
        return subprocess.run(SCAN + list(args) + [str(repo or self.repo)], env=self.env, capture_output=True,
                              text=True, timeout=120)

    def test_clean_history_passes(self):
        self.commit("a.txt", "nothing to see\n")
        out = self.scan("--allow", GOOD[0], "--allow", GOOD[1])
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
        self.assertIn("release-scan: clean", out.stdout)

    def test_no_allow_list_flags_every_identity(self):
        self.commit("a.txt", "nothing to see\n")
        out = self.scan()
        self.assertEqual(out.returncode, 1, out.stdout)
        self.assertIn("author name not on the allow list: 1 commit(s)", out.stdout)

    def test_history_hits_are_counted_by_kind_and_never_printed(self):
        self.commit("a.txt", "fine\n")
        # A stranger's commit on a branch that is not checked out, with a home path and a token that the
        # next commit removes again, so only the history (not the tree) still holds them.
        self.git("checkout", "-q", "-b", "side")
        self.commit("b.txt", f"path {HOME_PATH}\nkey {TOKEN}\n", who=STRANGER)
        self.commit("b.txt", "gone\n")
        self.git("checkout", "-q", "main")
        out = self.scan("--allow-file", self.write_allow(GOOD))
        self.assertEqual(out.returncode, 1, out.stdout)
        for line in ("author name not on the allow list: 1 commit(s)",
                     "committer e-mail address not on the allow list: 1 commit(s)",
                     "Linux home path: 1 added line(s)", "github token: 1 added line(s)"):
            self.assertIn(line, out.stdout)
        for secret in (TOKEN, HOME_PATH, "zedhome", STRANGER[0], STRANGER[1]):
            self.assertNotIn(secret, out.stdout + out.stderr)

    def test_denylist_hit_in_the_tree_is_counted_not_printed(self):
        self.commit("a.txt", f"a {DENIED} here\n")
        deny = Path(self.tmp.name) / "deny.txt"
        deny.write_text(DENIED + "\n", encoding="utf-8")
        out = self.scan("--allow", GOOD[0], "--allow", GOOD[1], "--denylist", str(deny))
        self.assertEqual(out.returncode, 1, out.stdout)
        self.assertIn("denylisted name: 1 line(s)", out.stdout)
        self.assertNotIn(DENIED, out.stdout + out.stderr)

    def test_shallow_clone_is_a_finding(self):
        self.commit("a.txt", "one\n")
        self.commit("a.txt", "two\n")
        shallow = Path(self.tmp.name) / "shallow"
        self.git("clone", "-q", "--depth", "1", repo_url(self.repo), str(shallow), cwd=self.tmp.name)
        out = self.scan("--allow", GOOD[0], "--allow", GOOD[1], repo=shallow)
        self.assertEqual(out.returncode, 1, out.stdout)
        self.assertIn("shallow clone", out.stdout)

    def test_not_a_repository_is_a_usage_error(self):
        out = self.scan(repo=self.tmp.name)
        self.assertEqual(out.returncode, 2)

    def write_allow(self, who):
        path = Path(self.tmp.name) / "allow.txt"
        path.write_text("# allowed\n" + "\n".join(who) + "\n", encoding="utf-8")
        return str(path)


def repo_url(path):
    return Path(path).resolve().as_uri()


if __name__ == "__main__":
    unittest.main()
