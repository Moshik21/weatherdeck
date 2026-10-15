"""Acceptance test for readability slice 3: a merged PR is never trouble or an ask, and old records fold under Housekeeping.

    python3 -m unittest discover -s tests

Added under the same deliberate, narrow exception as tests/test_approvallanes.py (CONTRIBUTING.md, "Tests"), as a task brief's named
acceptance test, for the host's lane rule (`src/weatherdeck/lanes.py` `agent_gone`) and the page's pure rules only (`web/frontdoor.js`
`rowState`, `isOldRecord`; the board model, the Lists plan and the Problems lines in `web/model.js` and `web/page.js`, run in Node over
the host's own view). Two synthetic feeds go in through the public `weatherdeck ingest` into a temporary data directory. Shaped like a
real fleet's cases: a lane paused after its PR merged whose worker's session then ended, an approval whose PR merged, an approval
whose PR was closed, and an old failed record whose books say a newer status replaced it. Beside them, live lanes: an approval with
its PR open, a live failure, a worker gone from running work, work under way and a lane paused at a gate. The old records are not off
course, not counted (waiting on you, the trouble badge, the Gun deck's outline, the Problems lines, the waiting count) and are listed
under Housekeeping, each with its reason; the live lanes keep their normal state. Synthetic sources, machines, titles and addresses,
standard library only, no network; the page half runs in Node when Node is installed and is skipped otherwise.
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
PR = "https://forge.invalid/team/borealis/pull/"
BUILD = "import json, sys; from weatherdeck import view; json.dump(view.build(now=float(sys.argv[1])), sys.stdout)"
DEFAULTS = json.loads((ROOT / "src" / "weatherdeck" / "defaults.json").read_text(encoding="utf-8"))
WORDS = DEFAULTS["labels"]

# The page's own scripts in one context (as tests/test_frontdoor.py does for the one sort), over the host's view.
PAGE = r"""
const vm = require("vm"), fs = require("fs");
const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub });
const store = {}, localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
const ctx = vm.createContext({ localStorage, performance: { now: () => 0 }, document: stub, window: stub, navigator: stub, addEventListener: stub, location: stub, console, Date, Math, JSON, Intl });
for (const f of ["theme.js", "frontdoor.js", "model.js", "board.js", "decks.js", "page.js"]) vm.runInContext(fs.readFileSync(process.argv[1] + "/web/" + f, "utf8"), ctx, { filename: f });
vm.runInContext(`globalThis.run = (view, labels, display, now, rowsMax, seen) => {
  if (seen) localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  S.srv0 = now; S.p0 = 0; S.view = view; S.theme = { components: {}, zones: { tv: { log: { rows_max: rowsMax || 14 } } } };
  S.server = { config: { labels, theme: {}, display, thresholds: {}, poll: {}, sound: {} } };
  const B = boardModel({ phone: false }), views = B.sorted.map(laneView), plan = listsPlan(views, pageGroups(B, views));
  const ids = rows => rows.map(r => r.id), hk = plan.find(p => p.kind === "housekeeping");
  const badge = m => shipBadge(B, m).filter(b => b.slot === "trouble").map(b => b.n);
  return { off: ids(B.off), outside: B.outside.map(w => w.id), asks: waitingOnYou(B.asks), keel: badge("keel"), spar: badge("spar"), waiting: ids(B.waiting), oldest: B.oldest ? B.oldest.id : null,
    gunDeck: deckCount("gun-deck", B, { id: "spar", flagship: true }).text, gunLoud: !!deckCount("gun-deck", B, { id: "spar", flagship: true }).loud,
    gunRows: ids(lanesOf(B, { flagship: true })), more: B.more, sea: ids(B.shown),
    rows: Object.fromEntries(B.lanes.map(l => [l.id, { key: l.rowKey, word: l.rowWord, old: l.rowOld, sentence: l.sentence, stage: l.stage }])),
    housekeeping: hk ? ids(hk.rows) : [], plan: plan.map(p => p.kind + ":" + p.key), problems: attentionLines(B, views).map(x => x.key + " " + (x.who || "") + " " + x.text), since: B.since };
};`, ctx);
process.stdout.write(JSON.stringify(ctx.run(...JSON.parse(process.argv[2]))));
"""


def iso(ago_s):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(NOW - ago_s))


def feed(sid, machine, items):
    return {"schema": "lookout.feed", "schema_version": "1.8", "generated_at": iso(0), "source": {"id": sid, "machine": machine},
            "items": items, "attention": []}


def lane(lid, state, **kw):
    return dict({"id": lid, "title": "Borealis " + lid.replace("-", " "), "state": state, "state_since": iso(3600)}, **kw)


ENDED = {"state": "ended", "since": iso(4 * 86400)}
SUPERSEDED = "run failed · status-log superseded (run failed)"
OLD = {
    # paused after its PR merged, its worker's session ended four days ago: finished but never closed
    "borealis-oneoff": lane("borealis-oneoff", "paused", waiting_on="external", agent=ENDED,
                            link={"url": PR + "6", "label": "pull request", "state": "merged"}),
    # still says it waits for the viewer's OK, but its PR merged: nothing left to approve
    "borealis-tier": lane("borealis-tier", "done", handoff={"state": "awaiting_you", "since": iso(4 * 86400)},
                          link={"url": PR + "1", "label": "pull request", "state": "merged"}),
    # says it waits for the viewer's OK, but its PR was closed unmerged
    "borealis-closed": lane("borealis-closed", "done", handoff={"state": "awaiting_you", "since": iso(86400)},
                            link={"url": PR + "2", "label": "pull request", "state": "closed"}),
    # a failed run its books say a newer status replaced
    "borealis-gates": lane("borealis-gates", "failed", summary=SUPERSEDED, doing=SUPERSEDED, state_detail=SUPERSEDED,
                           last_event={"state": "failed", "text": "run failed", "at": iso(5 * 86400)}),
}
REASONS = {"borealis-oneoff": "hk_gone_merged", "borealis-tier": "hk_approval_merged", "borealis-closed": "hk_approval_closed",
           "borealis-gates": "hk_unread"}
LIVE = {
    "borealis-twin": (lane("borealis-twin", "done", handoff={"state": "awaiting_you", "since": iso(1800)},
                           link={"url": PR + "15", "label": "pull request", "state": "open"}), "you"),
    "borealis-live-fail": (lane("borealis-live-fail", "failed"), "stuck"),
    "borealis-orphan": (lane("borealis-orphan", "running", agent={"state": "gone", "since": iso(3600)}), "stuck"),
    "atlas-run": (dict(lane("atlas-run", "running"), title="Atlas tile cache"), "work"),
    "atlas-gate": (dict(lane("atlas-gate", "paused", waiting_on="gate"), title="Atlas seed"), "other"),
}


def fleet(old=True, live=True):
    borealis = ([dict(it) for it in OLD.values()] if old else []) + [it for k, (it, _) in LIVE.items() if live and k.startswith("borealis")]
    atlas = [it for k, (it, _) in LIVE.items() if live and k.startswith("atlas")]
    return [feed("atlas", "keel", atlas), feed("borealis", "spar", borealis)]


def build_view(feeds):
    with tempfile.TemporaryDirectory() as tmp:
        env = dict(os.environ, WEATHERDECK_DATA=tmp, PYTHONDONTWRITEBYTECODE="1", PYTHONPATH=str(ROOT / "src"))
        for f in feeds:
            out = subprocess.run([sys.executable, str(ROOT / "bin" / "weatherdeck"), "ingest"], input=json.dumps(f),
                                 capture_output=True, text=True, env=env, timeout=60)
            assert out.returncode == 0 and out.stdout.startswith("ok"), out.stdout + out.stderr
        out = subprocess.run([sys.executable, "-c", BUILD, str(NOW)], capture_output=True, text=True, env=env, timeout=60)
        assert out.returncode == 0, out.stderr
        return json.loads(out.stdout)


def run_page(view, rows_max=14, seen=None):
    out = subprocess.run([NODE, "-e", PAGE, str(ROOT), json.dumps([view, WORDS, DEFAULTS["display"], NOW, rows_max, seen])],
                         capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


class HostRule(unittest.TestCase):
    """The host's half: a merged PR's lane is never agent_gone and never an ask, whatever its state says."""

    @classmethod
    def setUpClass(cls):
        cls.view = build_view(fleet())
        cls.items = {it["id"]: it for it in cls.view["items"]}

    def test_a_paused_lane_whose_agent_ended_after_its_pr_merged_is_not_off_course(self):
        lane = self.items["borealis-oneoff"]["lane"]
        self.assertNotEqual(lane["kind"], "agent_gone")
        self.assertNotIn(lane["cls"], ("needs_action", "running_long"))
        self.assertEqual(self.items["borealis-orphan"]["lane"]["kind"], "agent_gone")      # live: nobody at running work

    def test_approvals_whose_pr_merged_or_closed_are_not_counted(self):
        self.assertEqual(self.view["counts"]["waiting_on_you"], 1)                       # borealis-twin, PR open
        asks = [k for k, it in self.items.items() if it["lane"].get("asks_you")]
        self.assertEqual(asks, ["borealis-twin"])


@unittest.skipUnless(NODE, "Node is not installed: the page half is not run")
class PageRule(unittest.TestCase):
    """The page's half: the old records are listed under Housekeeping with their reasons and counted nowhere; live lanes keep their state."""

    @classmethod
    def setUpClass(cls):
        cls.view = build_view(fleet())
        cls.got = run_page(cls.view)
        cls.short = run_page(cls.view, rows_max=5)
        cls.only_old = run_page(build_view(fleet(live=False)))

    def test_the_old_records_are_listed_under_housekeeping_with_their_reasons(self):
        self.assertEqual(sorted(self.got["housekeeping"]), sorted(OLD))
        self.assertEqual(self.got["plan"][-1], "housekeeping:housekeeping")
        for lid, key in REASONS.items():
            row = self.got["rows"][lid]
            self.assertTrue(row["old"], lid)
            head = WORDS[key].split(":")[0] + ":"
            self.assertTrue(row["sentence"].startswith(head), (lid, row["sentence"]))
            self.assertNotIn("{", row["sentence"], lid)
            for raw in ("run failed", "superseded", "harness"):
                self.assertNotIn(raw, row["sentence"].lower(), lid)
        self.assertIn("nothing left to approve", self.got["rows"]["borealis-tier"]["sentence"])
        self.assertIn("#6", self.got["rows"]["borealis-oneoff"]["sentence"])
        self.assertNotEqual(self.got["rows"]["borealis-tier"]["stage"], "wait")         # not at the rail as an ask

    def test_the_old_records_are_not_off_course_and_not_counted(self):
        self.assertEqual(sorted(self.got["off"]), ["borealis-live-fail", "borealis-orphan"])
        self.assertEqual(self.got["asks"], 1)
        self.assertEqual((self.got["spar"], self.got["keel"]), ([2], []))
        self.assertIn(WORDS["off_course"].format(n=2), self.got["gunDeck"])
        self.assertEqual(sorted(self.got["waiting"]), ["atlas-gate", "borealis-twin"])      # the live waits only
        self.assertFalse([lid for lid in OLD if lid in self.got["outside"]])                 # none waits outside the fleet
        self.assertIn("borealis-twin", self.got["outside"])
        for line in self.got["problems"]:
            for lid in OLD:
                self.assertNotIn(lid, line)
                self.assertNotIn(OLD[lid]["title"], line)
        self.assertFalse([x for x in self.got["problems"] if x.startswith("u:")])     # no "can't be read" line for an old record
        for lid in OLD:
            self.assertIn(lid, self.got["gunRows"])                                     # still listed on the Gun deck, only not counted

    def test_with_only_old_records_nothing_is_counted_or_lit(self):
        g = self.only_old
        self.assertEqual((g["off"], g["asks"], g["spar"], g["keel"], g["gunLoud"], g["waiting"], g["oldest"]), ([], 0, [], [], False, [], None))
        self.assertEqual(g["problems"], [])
        self.assertEqual(sorted(g["housekeeping"]), sorted(OLD))

    def test_the_sea_counts_the_old_records_apart_in_its_overflow_line(self):
        self.assertTrue(self.short["more"])
        self.assertIn(WORDS["rcount_housekeeping"].format(n=4), self.short["more"])
        self.assertFalse([lid for lid in OLD if lid in self.short["sea"]])

    def test_since_you_looked_never_counts_an_old_record_as_newly_stuck(self):
        # the host reads a failed run whose PR merged as landed, so a blocked one stands for the stuck lane whose PR merged
        merged_fail = lane("borealis-merged-fail", "blocked", agent=ENDED, link={"url": PR + "9", "label": "pull request", "state": "merged"})
        items = [dict(OLD["borealis-gates"]), merged_fail, LIVE["borealis-live-fail"][0]]
        view = build_view([feed("borealis", "spar", items)])
        lanes = {it["id"]: it["lane"] for it in view["items"]}
        self.assertEqual((lanes["borealis-merged-fail"]["kind"], lanes["borealis-gates"]["kind"]), ("blocked", "failed"))
        self.assertEqual(len(view["glance"]["marks"]["stuck"]), 3)
        got = run_page(view, seen={"v": 1, "at": NOW - 3600, "calls": [], "stuck": []})
        self.assertTrue(got["rows"]["borealis-merged-fail"]["old"] and got["rows"]["borealis-gates"]["old"])
        self.assertEqual(got["since"]["stuck"], 1)                                           # borealis-live-fail only

    def test_the_live_lanes_keep_their_normal_state(self):
        for lid, (_, key) in LIVE.items():
            row = self.got["rows"][lid]
            self.assertEqual((row["key"], row["old"]), (key, False), lid)
            self.assertEqual(row["word"], WORDS["row_" + key], lid)


if __name__ == "__main__":
    unittest.main()
