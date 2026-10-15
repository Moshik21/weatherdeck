"""Synthetic demo feeds: the built-in way to see the page with no setup and no real data.

examples/demo/*.json are invented sources (one relays another's work, one goes silent after a
while). A Player re-times a fixture to "now" on every push and bumps its sequence, so the page
behaves as if live. Used by `weatherdeck run --demo` (in process) and `weatherdeck replay` (over HTTP).
"""
import copy
import json
import re
import threading
import time
import urllib.error
import urllib.request

from . import cards, config, ingest, schema

DEMO_DIR = config.ROOT / "examples" / "demo"
# Times of measurements move with each push; times of events stay where the first push put them.
MEASURED = {"generated_at", "as_of", "last_ok_at"}
# Dates (YYYY-MM-DD) move by whole days, so a hold "until tomorrow" in the fixture stays tomorrow.
DATED = {"until", "filed"}


def _fmt(epoch):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch))


class Player:
    def __init__(self, doc, interval, start=None):
        self.doc = doc
        self.interval = interval
        self.start = start or time.time()
        self.sid = doc["source"]["id"]
        self.boot = f"demo-{int(self.start)}"
        self.seq = 0
        self.base = schema.parse_time(doc["generated_at"])
        self.fixed = self.start - self.base

    def _walk(self, node, key, now_delta, fixed, grown):
        if isinstance(node, dict):
            return {k: self._walk(v, k, now_delta, fixed, grown) for k, v in node.items()}
        if isinstance(node, list):
            return [self._walk(v, key, now_delta, fixed, grown) for v in node]
        if isinstance(node, str) and schema.TIME_RE.match(node):
            return _fmt(schema.parse_time(node) + (now_delta if key in MEASURED else fixed))
        if isinstance(node, str) and key in DATED and schema.DATE_RE.match(node):   # a date moves by whole days with the fixture
            return time.strftime("%Y-%m-%d", time.gmtime(schema.parse_time(node + "T12:00:00Z") + round(fixed / 86400) * 86400))
        return node

    def build(self, now=None):
        now = now or time.time()
        doc = copy.deepcopy(self.doc)
        grown = now - self.start
        self.seq += 1
        out = self._walk(doc, None, now - self.base, self.fixed, grown)
        out["producer"].update(boot_id=self.boot, seq=self.seq, mode="sample")
        out["interval_s"] = self.interval
        for m in out["machines"]:
            if m.get("uptime_s") is not None:
                m["uptime_s"] += grown
        for it in out["items"]:
            cur = (it.get("progress") or {}).get("current")
            if cur and cur.get("activity") == "active":
                cur["elapsed_s"] = (cur.get("elapsed_s") or 0) + grown
                for st in it["progress"]["steps"]:
                    if st["status"] == "current":
                        st["elapsed_s"] = cur["elapsed_s"]
        out["events"] = [] if self.seq > 1 else [dict(e, at=int(e["at"] + self.fixed)) for e in out.get("events", [])]
        return out


def scenarios():
    return json.loads((DEMO_DIR / "scenarios.json").read_text())["scenarios"]


def apply_patch(doc, patch):
    """A scenario patch: dotted paths, list elements named by id; '+key' appends to a list, '^key' puts new entries first
    (the newest), keeping the list within the feed's cap."""
    for path, value in patch.items():
        value = copy.deepcopy(value)
        if path.startswith("+"):
            doc.setdefault(path[1:], []).extend(value)
            continue
        if path.startswith("^"):
            doc[path[1:]] = (value + doc.get(path[1:], []))[:schema.CAPS.get(path[1:], 1000)]
            continue
        *parents, last = path.split(".")
        node = doc
        for part in parents:
            node = next(x for x in node if x.get("id") == part) if isinstance(node, list) else node.setdefault(part, {})
        node[last] = value
    return doc


def load_players(interval, only=None, silence=None, scenario=None):
    manifest = json.loads((DEMO_DIR / "manifest.json").read_text())
    sc = scenarios()[scenario] if scenario else {}
    patch, quiet_after = sc.get("patch", {}), sc.get("silent_after_s", {})
    now = time.time()
    players = []
    for entry in manifest["sources"]:
        doc = json.loads((DEMO_DIR / entry["file"]).read_text())
        p = Player(apply_patch(doc, patch.get(doc["source"]["id"], {})), interval, now)
        if only and p.sid not in only:
            continue
        p.silent_after = (silence or {}).get(p.sid, quiet_after.get(p.sid, entry.get("silent_after_s")))
        p.paused = False
        players.append(p)
    return players


def _at_now(node, stamp):
    """A step's "@now" strings become the fixture time the step applies at (Player.build retimes it to now)."""
    if isinstance(node, dict):
        return {k: _at_now(v, stamp) for k, v in node.items()}
    if isinstance(node, list):
        return [_at_now(v, stamp) for v in node]
    return stamp if node == "@now" else node


def run_steps(players, steps, done, now, log=print):
    """Apply each scenario step whose after_s has passed (once): patch the sources, silence or resume them."""
    by_id = {p.sid: p for p in players}
    for i, step in enumerate(steps):
        if i in done or not players or now - players[0].start < step.get("after_s", 0):
            continue
        done.add(i)
        for sid, patch in (step.get("patch") or {}).items():
            p = by_id.get(sid)
            if p:
                apply_patch(p.doc, _at_now(patch, _fmt(now - p.fixed)))
        for sid in step.get("silence") or []:
            if sid in by_id:
                by_id[sid].paused = True
        for sid in step.get("resume") or []:
            if sid in by_id:
                by_id[sid].paused = False
        log(f"demo: step {i + 1}: {step.get('what', '')}")


def write_cards(directory, now):
    """The example cards (examples/cards), restamped to now: the demo's tool tiles."""
    for path in sorted((config.ROOT / "examples" / "cards").glob("*.json")):
        card = json.loads(path.read_text())
        card["updated_at"] = _fmt(now)
        cards.put(directory, card)


def run(push, interval=10, only=None, silence=None, stop=None, log=print, scenario=None, cards_dir=None):
    """Push every player each interval until `stop` is set. push(bytes) -> (ok, text)."""
    stop = stop or threading.Event()
    players = load_players(interval, only, silence, scenario)
    steps, applied = (scenarios()[scenario].get("steps") or []) if scenario else [], set()
    quiet = set()
    while not stop.is_set():
        t0 = time.time()
        if cards_dir:
            write_cards(cards_dir, t0)
        run_steps(players, steps, applied, t0, log)
        for p in players:
            if p.paused or (p.silent_after is not None and t0 - p.start >= p.silent_after):
                if p.sid not in quiet:
                    quiet.add(p.sid)
                    log(f"demo: source {p.sid} goes silent now")
                continue
            if p.sid in quiet:
                quiet.discard(p.sid)
                log(f"demo: source {p.sid} reports again")
            ok, text = push(json.dumps(p.build(t0)).encode())
            if not ok:
                log(f"demo: {p.sid}: {text}")
        stop.wait(max(0.5, interval - (time.time() - t0)))


def direct_push(raw):
    res = ingest.ingest(raw, transport="demo")
    return res.ok, res.text


def http_push(url, token=None):
    def push(raw):
        req = urllib.request.Request(url.rstrip("/") + "/api/ingest", data=raw, method="POST",
                                     headers={"Content-Type": "application/json"})
        if token:
            req.add_header("Authorization", "Bearer " + token)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return True, resp.read().decode().strip()
        except urllib.error.HTTPError as exc:
            return False, f"HTTP {exc.code}: {exc.read().decode(errors='replace').strip()}"
        except (urllib.error.URLError, OSError) as exc:
            return False, f"unreachable: {exc}"
    return push
