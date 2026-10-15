"""Contract tests for feed 1.11 `waiting.note` (unreleased): a source whose waiting number is unverified may name the attention card
that explains it, and the board and the decks drop exactly that card instead of matching an id prefix. Synthetic feeds, standard
library only, no network. The page scripts are plain JavaScript; the tests run them in Node when it is installed (the pattern of
test_weather.py), loading the page scripts up to web/decks.js into one context with the few browser globals they touch at load."""
import copy
import json
import pathlib
import shutil
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
from weatherdeck import schema, view as hostview  # noqa: E402

NODE = shutil.which("node")
HARNESS = r"""
const vm = require("vm"), fs = require("fs");
const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub });   // any DOM call at load answers with itself
const ctx = vm.createContext({ performance: { now: () => 0 }, document: stub, window: stub, navigator: stub, addEventListener: stub, location: stub, console, Date, Math, JSON });
for (const f of ["theme.js", "frontdoor.js", "model.js", "board.js", "decks.js"]) vm.runInContext(fs.readFileSync(process.argv[1] + "/web/" + f, "utf8"), ctx, { filename: f });
vm.runInContext(`globalThis.run = (view, ship) => {
  S.view = view; S.theme = { components: {}, zones: {} }; S.server = { config: { labels: {}, theme: {}, display: {}, thresholds: {}, poll: {}, sound: {} } };
  const B = boardModel(null);
  return { unverified: B.unverified, also: B.also.map(a => a.id), lines: alsoLines(B, B.unverified).map(l => l[1]),
           rows: bridgeRows(B, ship).map(r => r.key) };
};`, ctx);
process.stdout.write(JSON.stringify(ctx.run(JSON.parse(process.argv[2]), { flagship: true })));
"""
NOTE_ID = "note:src-a"
CARD = {"id": NOTE_ID, "source": "src-a", "kind": "info", "severity": "info", "title": "Waiting on you is unverified here", "machine": "m1"}
OTHER = {"id": "disk:m1", "source": "src-a", "kind": "disk", "severity": "info", "title": "Disk is filling", "machine": "m1"}
FOREIGN = {"id": NOTE_ID, "source": "src-b", "kind": "info", "severity": "info", "title": "Another source's card", "machine": "m2"}


def view(waiting, cards):
    src = lambda sid, m, w: {"id": sid, "label": sid, "machine": m, "received_at": 0, "generated_at": "1970-01-01T00:00:00Z",
                             "freshness": [], "waiting": w}
    return {"now": 0, "sources": [src("src-a", "m1", waiting), src("src-b", "m2", None)],
            "machines": [{"id": "m1", "label": "Alpha"}, {"id": "m2", "label": "Beta"}], "attention": cards, "items": []}


UNVERIFIED = {"basis": "unverified", "verified": False, "reason": "no copy yet"}


@unittest.skipUnless(NODE, "Node is not installed: the page scripts are not run")
class WaitNote(unittest.TestCase):
    def run_js(self, v):
        out = subprocess.run([NODE, "-e", HARNESS, str(ROOT), json.dumps(v)], capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)

    def test_the_named_card_is_dropped_from_the_board_and_the_decks(self):
        r = self.run_js(view(dict(UNVERIFIED, note=NOTE_ID), [CARD, OTHER]))
        self.assertEqual(r["unverified"][0]["note"], NOTE_ID)
        self.assertEqual(r["also"], [NOTE_ID, "disk:m1"])   # the model still carries it; the two views leave it out
        self.assertEqual([l for l in r["lines"] if "unverified here" in l], [])
        self.assertIn("Disk is filling", r["lines"])
        self.assertEqual([k for k in r["rows"] if k.startswith("unverified:")], ["unverified:src-a"])
        self.assertNotIn(NOTE_ID, r["rows"])
        self.assertIn("disk:m1", r["rows"])

    def test_without_a_note_the_card_shows(self):
        r = self.run_js(view(UNVERIFIED, [CARD, OTHER]))
        self.assertIsNone(r["unverified"][0]["note"])
        self.assertIn("Waiting on you is unverified here", r["lines"])
        self.assertIn(NOTE_ID, r["rows"])

    def test_only_the_named_card_of_the_same_source_goes(self):
        r = self.run_js(view(dict(UNVERIFIED, note=NOTE_ID), [FOREIGN]))
        self.assertIn("Another source's card", r["lines"])   # same id, another source: it stays
        self.assertIn(NOTE_ID, r["rows"])

    def test_a_guest_and_the_public_still_lose_the_named_card(self):
        for level in ("guest", "public"):
            v = copy.deepcopy(view(dict(UNVERIFIED, note=NOTE_ID), [CARD, OTHER]))
            v.update({"cards": [], "attention_pending": [], "next": [], "done": [], "groups": [], "goals": [],
                      "history": {"timeline": [], "notes": []},
                      "gaps": {"waits_outside": [], "oldest_waiting": None, "queues": [], "coming_up": [], "deploys": []}})
            hostview.redact(v, level, {})
            note = v["sources"][0]["waiting"]["note"]
            self.assertNotEqual(note, NOTE_ID)   # an attention id is hidden here, the note with it
            self.assertEqual(note, v["attention"][0]["id"])
            r = self.run_js(v)
            self.assertEqual([k for k in r["rows"] if k.startswith("unverified:")], ["unverified:src-a"], level)
            self.assertNotIn(note, r["rows"], level)
            self.assertIn(v["attention"][1]["id"], r["rows"], level)

    def test_a_verified_number_drops_nothing(self):
        r = self.run_js(view({"basis": "source", "verified": True, "note": NOTE_ID}, [CARD]))
        self.assertEqual(r["unverified"], [])
        self.assertIn("Waiting on you is unverified here", r["lines"])

    def test_the_schema_accepts_waiting_note(self):
        doc = {"schema": "lookout.feed", "schema_version": "1.11", "source": {"id": "src-a"},
               "waiting": dict(UNVERIFIED, note=NOTE_ID)}
        clean, warn = schema.validate(doc)
        self.assertEqual(clean["waiting"]["note"], NOTE_ID)
        self.assertEqual(warn, [])
        clean, warn = schema.validate(dict(doc, waiting=UNVERIFIED))   # a pusher older than 1.11 sends none
        self.assertNotIn("note", clean["waiting"])
        self.assertEqual(warn, [])


if __name__ == "__main__":
    unittest.main()
