"""Contract tests for the allowlist behind the household, guest and public views (unreleased).

    python3 -m unittest discover -s tests

Added under the same deliberate, narrow exception as tests/test_calloptions.py (CONTRIBUTING.md, "Tests"), for pure core logic only:
what `src/weatherdeck/view.py` `redact` leaves of a field the host does not list (`src/weatherdeck/allowlist.py`), of the three
fields of free text it used to leave, and of a sentence put in a field that holds a word or a name. Synthetic data only, standard library only, no network, no clock.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import view  # noqa: E402

PRIVATE = "SYNTHETIC_PRIVATE"


CARD = {"tool": "t", "title": "T", "status": "ok", "mode": "live", "updated_at": "2026-01-01T00:00:00Z", "stale_after_s": 900,
        "headline": PRIVATE, "numbers": [{"label": "n", "value": PRIVATE}], "link": {"url": "https://example.test/" + PRIVATE, "label": PRIVATE}}


def full_view():
    return {"cards": [CARD], "sources": [{"id": "s", "label": "s", "extension": PRIVATE, "pace": {"slowed": True, "factor": 2, "why": [PRIVATE]}, "skew": [{"since": "1.2", "effect": PRIVATE, "newer_version": "1.3", "newer_source": "t"}], "collectors": [{"id": "c", "extension": PRIVATE}]}],
            "machines": [{"id": "m", "label": "Box", "extension": PRIVATE, "pressure": {"level": "warn", "why": [PRIVATE], "extension": PRIVATE}}],
            "items": [{"id": "a", "title": "A job", "phase": "verify", "extension": PRIVATE, "progress": {"steps": [{"id": "1", "extension": PRIVATE}]}}],
            "attention": [{"id": "c", "title": "A call", "extension": PRIVATE}], "attention_pending": [], "next": [], "done": [], "groups": [],
            "omitted": [{"surface": "items", "shown": 1, "total": 2, "reason": PRIVATE, "source": "s", "extension": PRIVATE}],
            "history": {"timeline": [], "notes": [{"at": 1, "source": "s", "item": None, "text": PRIVATE}]},
            "gaps": {"waits_outside": [], "oldest_waiting": None, "queues": [], "coming_up": [], "deploys": []}, "extension": PRIVATE}


SENTENCE = PRIVATE + " said as a whole sentence in a field that holds a word"


def vocab_view(word, name, runway="exhausts_before_reset", verb="done", pressure="warn", activity="quiet", verdict="pass"):
    """The full view with `word` in every field that holds a word, `name` in every one that holds a short name."""
    v = full_view()
    v["machines"][0].update(role=name, load={"runq_basis": name}, mem={"native_pressure": pressure})
    v["items"][0].update(kind=word, source_lane={"cause": word, "last_word": {"verb": verb, "at": None}},
                         say=[{"t": word, "how": word, "gate": word, "decides": "worker", "verb": word}],
                         progress={"steps": [], "current": {"activity": activity}})
    v["attention"] = [{"id": "c", "kind": word, "actor": {"role": "viewer", "name": "n"}, "hold": {"bucket": word}}]
    v["next"] = [{"id": "n", "kind": word, "hold": {"bucket": word}}]
    v["groups"] = [{"id": "g", "checkpoint": {"gate": {"value": verdict, "tiers": [{"id": "t", "verdict": verdict}]}}}]
    v["meters"] = {"accounts": [{"id": "a", "label": name, "provider": name, "account": name,
                                 "windows": [{"id": "w", "label": name, "short": name, "pace": word}],
                                 "runway": {"status": runway, "confidence": word, "source": name}}],
                   "chips": [{"id": "a", "provider": name, "account": name, "left": 4, "state": "out", "sentence": str(name) + " may run out",
                              "forms": [str(name) + " 4%", str(name)], "window": {"id": "w", "label": name, "short": name},
                              "projection": {"status": runway, "confidence": word, "source": name}}]}
    return v


# Every other field a source copies whose contract is a fixed word, a version or a short name: (path, a legal value, what a sentence
# becomes, the levels that keep the field at all).
EVERY = ("household", "guest", "public")
LISTED = [
    ("machines.0.status", "warn", "unknown", EVERY), ("machines.0.stations.0.status", "down", "unknown", EVERY),
    ("machines.0.pressure.level", "critical", None, EVERY), ("machines.0.health.state", "maintenance", None, EVERY),
    ("machines.0.beat.version", "1.4.2", None, EVERY),
    ("attention.0.severity", "critical", "info", EVERY), ("attention.0.verdict.state", "pending", "unknown", EVERY),
    ("attention.0.link.state", "merged", None, ("household",)),
    ("items.0.state", "blocked", "unknown", EVERY), ("items.0.phase", "land", None, EVERY),
    ("items.0.waiting_on", "quiet_hours", None, EVERY), ("items.0.flags.0", "fix_round", None, ("household", "guest")),
    ("items.0.handoff.state", "awaiting_you", "unknown", EVERY), ("items.0.agent.state", "gone", "unknown", EVERY),
    ("items.0.link.state", "open", None, ("household",)), ("items.0.reported.basis", "reported", None, EVERY),
    ("items.0.source_lane.state", "Can't tell", None, EVERY), ("items.0.lane.waiting_on", "pr", None, EVERY),
    ("items.0.progress.basis", "history", "none", EVERY), ("items.0.progress.steps.0.status", "skipped", "unknown", EVERY),
    ("sources.0.kind", "agent runner", None, EVERY), ("sources.0.collectors.0.status", "stale", None, EVERY),
    ("sources.0.waiting.basis", "cached", None, EVERY), ("sources.0.producer.name", "demo-adapter", None, EVERY),
    ("sources.0.producer.version", "1.4.2", None, EVERY), ("sources.0.producer.pusher.name", "demo-pusher", None, EVERY),
    ("sources.0.producer.pusher.version", "0.3", None, EVERY), ("sources.0.skew.0.since", "1.2", None, EVERY),
    ("sources.0.skew.0.newer_version", "1.3", None, EVERY),
    ("gaps.mirrors.0.outcome", "nothing_new", None, ("household", "guest")),
    ("done.0.via", "local merge", None, ("household",)), ("done.0.link.state", "closed", None, ("household",)),
    ("groups.0.color", "#1a2B3c", None, EVERY), ("groups.0.checkpoint.live.version", "2.0.1", None, EVERY),
    ("groups.0.checkpoint.next.version", "2.1.0", None, EVERY), ("omitted.0.surface", "machines[cua-host-1].extras", None, EVERY),
    ("history.timeline.0.kind", "completed", None, ("household", "guest")),
]


def put(root, path, value):
    node, keys = root, path.split(".")
    for key, nxt in zip(keys, keys[1:] + [None]):
        make = {} if nxt is None or not nxt.isdigit() else []
        if key.isdigit():
            while len(node) <= int(key):
                node.append(make)
            if nxt is None:
                node[int(key)] = value
            node = node[int(key)]
        elif nxt is None:
            node[key] = value
        else:
            node = node.setdefault(key, make)


def get(root, path):
    for key in path.split("."):
        root = root[int(key)] if key.isdigit() else root[key]
    return root


def listed_view(value_of):
    v = full_view()
    v.update(done=[{"id": "d"}], groups=[{"id": "g"}], omitted=[{"shown": 1}], next=[])
    v["history"]["timeline"] = [{"at": 1, "item": None, "text": "t"}]
    v["gaps"]["mirrors"] = [{"id": "m"}]
    v["machines"][0].pop("pressure")
    v["items"][0].pop("progress")
    for path, legal, fallback, levels in LISTED:
        put(v, path, value_of(legal))
    return v


def leaks(node, path=""):
    if isinstance(node, dict):
        return [p for k, v in node.items() for p in leaks(v, path + "." + k)]
    if isinstance(node, list):
        return [p for i, v in enumerate(node) for p in leaks(v, "%s[%d]" % (path, i))]
    return [path] if isinstance(node, str) and PRIVATE in node else []


class Redacted(unittest.TestCase):
    def test_no_unknown_field_and_no_reason_prose_reaches_a_redacted_view(self):
        for level in ("household", "guest", "public"):
            v = full_view()
            view.redact(v, level, {})
            self.assertEqual(leaks(v), [], level)
            self.assertNotIn("extension", v)

    def test_a_card_keeps_only_its_structure(self):
        shown = {"household": ["tool", "title", "status", "mode", "updated_at", "stale_after_s"],
                 "guest": ["tool", "status", "mode", "updated_at", "stale_after_s"]}
        for level, keys in shown.items():
            v = full_view()
            view.redact(v, level, {})
            self.assertEqual(v["cards"], [{k: CARD[k] for k in keys}], level)
        v = full_view()
        view.redact(v, "public", {})
        self.assertEqual(v["cards"], [])

    def test_the_known_fields_stay(self):
        for level in ("household", "guest", "public"):
            v = full_view()
            view.redact(v, level, {})
            self.assertEqual(v["machines"][0]["pressure"], {"level": "warn", "why": []}, level)
            self.assertEqual(v["omitted"], [{"surface": "items", "shown": 1, "total": 2, "reason": None, "source": "s"}], level)
            self.assertEqual(v["sources"][0]["collectors"][0]["id"], "c", level)
            self.assertEqual(v["items"][0]["phase"], "verify", level)
            self.assertEqual(v["sources"][0]["pace"], {"slowed": True, "factor": 2, "why": []}, level)
            self.assertEqual(v["sources"][0]["skew"], [{"since": "1.2", "effect": "", "newer_version": "1.3", "newer_source": "t"}], level)

    def test_a_sentence_in_a_field_that_holds_a_word_is_replaced_by_the_unknown_word(self):
        for level in ("household", "guest", "public"):
            v = vocab_view(SENTENCE, SENTENCE, runway=SENTENCE, verb=SENTENCE, pressure=SENTENCE, activity=SENTENCE, verdict=SENTENCE)
            view.redact(v, level, {})
            self.assertEqual(leaks(v), [], level)
            self.assertEqual(v["items"][0]["progress"]["current"]["activity"], "unknown", level)
            self.assertEqual(v["groups"][0]["checkpoint"]["gate"]["value"], "unknown", level)
            self.assertEqual(v["groups"][0]["checkpoint"]["gate"]["tiers"], [{"id": "t", "verdict": "unknown"}], level)
            self.assertEqual(v["meters"]["accounts"][0]["runway"]["status"], "unknown", level)
            self.assertIsNone(v["items"][0]["source_lane"]["last_word"]["verb"], level)
            self.assertIsNone(v["machines"][0]["mem"]["native_pressure"], level)
            self.assertEqual(v["meters"]["chips"][0]["provider"], "?", level)
            self.assertEqual(v["meters"]["chips"][0]["forms"], ["? 4%"], level)
            self.assertIsNone(v["meters"]["chips"][0]["sentence"], level)

    def test_a_number_or_an_object_in_a_field_that_holds_a_word_is_replaced_too(self):
        for level in ("household", "guest", "public"):
            for odd in (7, {"x": SENTENCE}, [SENTENCE], True):
                v = vocab_view(odd, odd, runway=odd, verb=odd, pressure=odd, activity=odd, verdict=odd)
                view.redact(v, level, {})
                self.assertEqual(leaks(v), [], level)
                self.assertEqual(v["items"][0]["progress"]["current"]["activity"], "unknown", level)
                self.assertIsNone(v["attention"][0]["hold"]["bucket"], level)

    def test_the_words_and_names_a_source_may_send_stay(self):
        word, name = "tests-running", "Weekly (all models)"
        for level in ("household", "guest", "public"):
            v = vocab_view(word, name)
            view.redact(v, level, {})
            self.assertEqual(v["items"][0]["kind"], word, level)
            self.assertEqual((v["items"][0]["source_lane"]["cause"], v["items"][0]["source_lane"]["last_word"]), (word, {"verb": "done", "at": None}), level)
            self.assertEqual(v["items"][0]["say"], [{"t": word, "how": word, "gate": word, "decides": "worker", "verb": word}], level)
            self.assertEqual(v["items"][0]["progress"]["current"], {"activity": "quiet"}, level)
            self.assertEqual(v["attention"][0]["actor"], {"role": "viewer", "name": "n" if level == "household" else None}, level)
            self.assertEqual(v["attention"][0]["hold"]["bucket"], word, level)
            self.assertEqual(v["groups"][0]["checkpoint"]["gate"]["value"], "pass", level)
            self.assertEqual((v["machines"][0]["role"], v["machines"][0]["load"], v["machines"][0]["mem"]),
                             (name, {"runq_basis": name}, {"native_pressure": "warn"}), level)
            self.assertEqual(v["meters"]["accounts"][0]["windows"], [{"id": "w", "label": name, "short": name, "pace": word}], level)
            self.assertEqual(v["meters"]["accounts"][0]["runway"], {"status": "exhausts_before_reset", "confidence": word, "source": name}, level)
            self.assertEqual(v["meters"]["chips"][0]["forms"], [name + " 4%", name], level)
            self.assertEqual(v["meters"]["chips"][0]["sentence"], name + " may run out", level)

    def test_a_sentence_in_any_other_word_field_is_replaced_by_the_unknown_word_or_nothing(self):
        for level in ("household", "guest", "public"):
            v = listed_view(lambda legal: SENTENCE)
            view.redact(v, level, {})
            self.assertEqual(leaks(v), [], level)
            for path, legal, fallback, levels in LISTED:
                if level in levels:
                    self.assertEqual(get(v, path), fallback, (level, path))

    def test_a_number_or_an_object_in_any_other_word_field_is_replaced_too(self):
        for level in ("household", "guest", "public"):
            for odd in (7, {"x": SENTENCE}, True):
                v = listed_view(lambda legal: odd)
                view.redact(v, level, {})
                self.assertEqual(leaks(v), [], level)
                for path, legal, fallback, levels in LISTED:
                    if level in levels:
                        self.assertEqual(get(v, path), fallback, (level, path))

    def test_the_legal_value_of_every_other_word_field_stays(self):
        for level in ("household", "guest", "public"):
            v = listed_view(lambda legal: legal)
            view.redact(v, level, {})
            for path, legal, fallback, levels in LISTED:
                if level in levels:
                    self.assertEqual(get(v, path), legal, (level, path))

    def test_a_word_the_spec_lists_in_full_is_never_read_as_another_word(self):
        v = listed_view(lambda legal: legal)
        put(v, "machines.0.status", "ok")
        put(v, "items.0.state", "garbage")
        put(v, "attention.0.severity", "Critical")
        view.redact(v, "household", {})
        self.assertEqual((v["machines"][0]["status"], v["items"][0]["state"], v["attention"][0]["severity"]), ("ok", "unknown", "info"))


if __name__ == "__main__":
    unittest.main()
