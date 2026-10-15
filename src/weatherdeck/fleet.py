"""The fleet: one ship per machine (docs/feed-spec.md, "The fleet"; docs/theme-spec.md section 21).

Pure functions: no I/O, no clock, nothing about any particular tool. A ship is wherever work runs (a machine id in the
feed: a laptop, a desktop, a CI service). The host decides the fleet's shape, which never moves with the data; the page
judges each machine's state on its own clock (as it always has) and applies `berth`, `hull_word` and `convoy_summary`
in the same terms (web/model.js mirrors them):

    flagship        the primary source's machine (or the configured one): the ship in front, carrying the fleet's decks
    order           flagship first, then the configured order, then by name: never sorted by state, so ships never
                    swap places
    plan            the ships drawn (the flagship and up to five escorts) and the convoy past them, by position only
    berth           at sea, moored in the harbor (idle and healthy) or at anchor (asleep, a dim lantern)
    hull_word       the one word on a ship's hull plate for its machine state, and whether it reads neutral
    convoy_summary  the convoy's count plate: how many ships, and the words that are not OK, worst first
    roadstead       the horizon shared out: each ship drawn gets its own stretch of the scene's window (shares of its
                    width, left to right, never overlapping another escort's) and a scale, for the open sea (nothing
                    waits on the viewer: the scene has the whole upper area) and for the narrow window beside a call
"""
import re

MAX_SHIPS = 6                    # ships drawn at most (the flagship and five escorts); past that a convoy (rule 4)

# One word per machine state, worst first. Neutral words read in ink2 (no alarm): OK and a declared rest.
HULL_ORDER = ("alert", "down", "lost", "silent", "warn", "unconfirmed", "unknown", "asleep", "draining", "maintenance", "reserved", "ok")
HULL_WORDS = {
    "alert": ("alert", False),             # a critical is on it
    "down": ("not_answering", False),
    "lost": ("lost", False),               # its health beat stopped
    "silent": ("silent", False),           # its reporters went quiet
    "warn": ("struggling", False),         # against its own norm (or a low disk, on battery)
    "unconfirmed": ("unconfirmed", False),  # an alert said in one feed, not yet confirmed by a second (debounce.py)
    "unknown": ("no_word", False),
    "asleep": ("asleep", True),            # a may_sleep machine quiet in quiet hours: expected
    "draining": ("draining", True),
    "maintenance": ("maintenance", True),
    "reserved": ("reserved", True),
    "ok": ("ok", True),
}
CALM = ("ok", "draining", "maintenance", "reserved")   # states a ship may moor in; silence never moors (rule 3)


def fold(text):
    """A name as it sorts: case folded, hyphens and underscores as spaces, runs of space as one."""
    return re.sub(r"\s+", " ", re.sub(r"[-_]+", " ", str(text or "").casefold())).strip()


def flagship(sources, machines, configured=None):
    """The flagship's machine id: the configured one when it is a known machine, else the primary source's machine,
    else the first reporting source's (in the view's order), else the first machine by name; None with no machine."""
    ids = [m.get("id") for m in machines or [] if m.get("id")]
    if configured and configured in ids:
        return configured
    rep = [s for s in sources or [] if not s.get("placeholder") and s.get("machine")]
    prim = next((s for s in rep if s.get("kind") == "primary"), rep[0] if rep else None)
    if prim:
        return prim["machine"]
    named = sorted(machines or [], key=lambda m: (fold(m.get("label") or m.get("id")), str(m.get("id"))))
    return named[0]["id"] if named else None


def order(machines, flag=None, configured=()):
    """Machine ids in their fixed order: the flagship, then those the config lists (in its order), then the rest by
    folded name and id. Nothing about a machine's state takes part, so a ship keeps its place."""
    by_id = {m["id"]: m for m in machines or [] if m.get("id")}
    out = [flag] if flag in by_id else []
    for mid in configured or ():
        if mid in by_id and mid not in out:
            out.append(mid)
    rest = sorted((m for mid, m in by_id.items() if mid not in out), key=lambda m: (fold(m.get("label") or m["id"]), str(m["id"])))
    return out + [m["id"] for m in rest]


def plan(ordered, max_ships=MAX_SHIPS):
    """-> {ships: [{id, role, slot}], convoy: [id]}. The first is the flagship (slot 0); up to max_ships - 1 escorts
    follow (slots 1..); every machine past max_ships sails in the convoy, said as one count plate. By position only."""
    cap = max(1, min(MAX_SHIPS, int(max_ships or MAX_SHIPS)))
    ids = list(ordered or [])
    shown = ids if len(ids) <= cap else ids[:cap]
    ships = [{"id": mid, "role": "flagship" if i == 0 else "escort", "slot": i} for i, mid in enumerate(shown)]
    return {"ships": ships, "convoy": ids[len(shown):]}


def berth(key, asleep=False, lanes=0, calls=0):
    """Where a ship lies: 'anchored' while asleep (a may_sleep machine quiet in quiet hours), 'harbor' when idle and
    healthy (a calm state, no lanes on it and no call or critical on it), else 'sea'. A silent, lost, struggling or
    alerting machine never moors: silence never looks healthy."""
    if asleep:
        return "anchored"
    if key in CALM and not lanes and not calls:
        return "harbor"
    return "sea"


def hull_word(key, asleep=False):
    """(word id, neutral) for a ship's hull plate: one word per machine state (labels machine_<word id> say it)."""
    if asleep:
        return HULL_WORDS["asleep"]
    return HULL_WORDS.get(key, HULL_WORDS["unknown"])


def convoy_summary(states):
    """The convoy's count plate. states: [(key, asleep)] per ship in the convoy. -> {n, words: [[word id, count]]}: the
    words that are not OK, worst first; the plate says '+4 ships · 1 silent'. Nothing in the convoy is dropped: n is
    the true total."""
    counts = {}
    for key, asleep in states or []:
        k = "asleep" if asleep else (key if key in HULL_WORDS else "unknown")
        counts[k] = counts.get(k, 0) + 1
    words = [[HULL_WORDS[k][0], counts[k]] for k in HULL_ORDER if k != "ok" and counts.get(k)]
    return {"n": len(states or []), "words": words}


# The horizon's shares (docs/theme-spec.md section 21), as fractions of the scene window's width. The flagship's stretch
# comes first, then one equal stretch per escort, then the convoy's at the far end; GAP apart. Only the number of ships
# and whether a convoy sails decide them, never a machine's state, so a ship keeps its place while its window stays.
FULL_MAX = 3                     # on the open sea, with at most three ships drawn, the escorts sail at full scale
OPEN_FLAG = {1: (0.1, 0.8), 2: (0.0, 0.56), 3: (0.0, 0.5), 4: (0.0, 0.44), 5: (0.0, 0.4), 6: (0.0, 0.36)}
# Beside a call the window is narrow and every escort is at half scale; with five escorts the flagship's own stretch is
# smaller than its hull, so it sails in front of the first escorts (it never hides an escort's plate).
CALL_FLAG = {1: 1.0, 2: 0.62, 3: 0.52, 4: 0.42, 5: 0.3, 6: 0.16}
CONVOY = {"open": 0.07, "call": 0.11}
GAP = {"open": 0.02, "call": 0.01}


def roadstead(n, convoy=False, open_sea=False):
    """-> {open, ships: [{slot, x0, x1, scale}], convoy: {x0, x1} | None}: the stretch of the scene window each ship drawn
    may use (x0 < x1, fractions 0..1 of its width, left to right in slot order) and its scale ('full' or 'half'). Escort
    stretches never overlap one another or the convoy's; the flagship's is first. n is the ships drawn (1..6)."""
    n = max(1, min(MAX_SHIPS, int(n or 1)))
    mode = "open" if open_sea else "call"
    gap, conv = GAP[mode], (CONVOY[mode] if convoy else 0.0)
    fx0, fx1 = OPEN_FLAG[n] if open_sea else (0.0, CALL_FLAG[n] - (conv if n == 1 else 0.0))
    if convoy and not open_sea and n > 1:
        fx1 = max(0.0, fx1 - conv / 2)
    ships = [{"slot": 0, "x0": fx0, "x1": fx1, "scale": "full"}]
    end = 1.0 - (conv + gap if conv else 0.0)
    k = n - 1
    if k:
        start = fx1 + gap
        w = (end - start - gap * (k - 1)) / k
        scale = "full" if open_sea and n <= FULL_MAX else "half"
        for i in range(k):
            x0 = start + i * (w + gap)
            ships.append({"slot": i + 1, "x0": x0, "x1": x0 + w, "scale": scale})
    r = lambda v: round(v, 4)
    return {"open": bool(open_sea), "ships": [dict(s, x0=r(s["x0"]), x1=r(s["x1"])) for s in ships],
            "convoy": {"x0": r(1.0 - conv), "x1": 1.0} if conv else None}


def view(sources, machines, display):
    """The view's `fleet`: {flagship, order, ships, convoy, max_ships, roadstead} from the config's display.fleet
    ({flagship, order, max_ships}); roadstead holds the horizon's shares for the open sea and beside a call."""
    fc = (display or {}).get("fleet") or {}
    flag = flagship(sources, machines, fc.get("flagship"))
    ordered = order(machines, flag, fc.get("order") or ())
    cap = max(1, min(MAX_SHIPS, int(fc.get("max_ships") or MAX_SHIPS)))
    p = plan(ordered, cap)
    n, conv = len(p["ships"]) or 1, bool(p["convoy"])
    road = {"open": roadstead(n, conv, True), "call": roadstead(n, conv, False)}
    return {"flagship": flag, "order": ordered, "ships": p["ships"], "convoy": p["convoy"], "max_ships": cap, "roadstead": road}
