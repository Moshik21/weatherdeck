"""At a glance: what changed since a screen last looked, and the order rows are grouped in (docs/feed-spec.md, "The
view at a glance").

Pure functions: no I/O, no clock of their own (every time is passed in), nothing about any particular tool. The host
calls them while it builds the view; the page applies the same rules to what it keeps in its own browser storage:

    key             an opaque short key for a thing on the board (a call, a stuck lane), never its id or title
    marks           what the board holds now, as opaque keys and landing times: what a screen remembers as last seen
    delta           landed, new calls and newly stuck since a screen's last look, from two sets of marks
    projects        rows grouped by project first and machine second, in a fixed order that never moves with the data
    relative        a time against now in plain words: 'just now', '12 min ago', 'in 3 h'

A screen's last look stays in that browser (localStorage) and is never sent to the host: the host hands every screen the
same marks, and each screen compares them with its own copy.
"""
import hashlib

from . import gaps

STUCK_KINDS = ("failed", "blocked", "agent_gone", "long")   # needs action or running long, not a call (calls count apart)


def key(*parts):
    """An opaque 12-hex key for a thing on the board, from its source and id. Stable across host restarts (no salt), so a
    screen's memory survives one; it carries no id or title, so what a browser stores says nothing by itself."""
    raw = "\x1f".join("" if p is None else str(p) for p in parts)
    return hashlib.sha256(("weatherdeck-glance\x1f" + raw).encode("utf-8")).hexdigest()[:12]


def _stuck(it):
    lane = it.get("lane") or {}
    return lane.get("cls") in ("needs_action", "running_long") and lane.get("kind") in STUCK_KINDS


def marks(items, attention, landed_at):
    """What the board holds now, in the form a screen remembers it.

    items: the view's items (with their host `lane`); attention: the view's attention cards; landed_at: epoch times of
    the work that landed in the board's landed window. -> {calls: [key], stuck: [key], landed: [epoch]}, each sorted.
    calls are the cards that wait on the viewer (severity action); stuck are lanes off course that are not a call
    (failed, blocked, no agent at the work, running long)."""
    calls = sorted({key("call", a.get("source"), a.get("id")) for a in attention or [] if a.get("severity") == "action" and a.get("id") is not None})
    stuck = sorted({key("lane", it.get("owner") or it.get("source"), it.get("id")) for it in items or [] if _stuck(it)})
    landed = sorted(float(t) for t in landed_at or [] if isinstance(t, (int, float)) and not isinstance(t, bool))
    return {"calls": calls, "stuck": stuck, "landed": landed}


def delta(seen, now_marks, min_away_s=0.0, now=None):
    """What changed since a screen last looked. seen: {at, calls, stuck} as the screen stored it (None on a first visit);
    now_marks: marks() now. -> {since, away_s, landed, calls, stuck, any} or None.

    landed counts work that landed after the last look; calls and stuck count keys the screen had not seen. None on a
    first visit, for a look less than `min_away_s` ago, or for a stored look that is not readable (a screen never
    guesses what it saw)."""
    if not isinstance(seen, dict) or not isinstance(seen.get("at"), (int, float)) or isinstance(seen.get("at"), bool):
        return None
    at = float(seen["at"])
    away = (now - at) if now is not None else None
    if away is not None and away < max(0.0, min_away_s or 0.0):
        return None
    had = {k: set(seen.get(k) or []) if isinstance(seen.get(k), list) else set() for k in ("calls", "stuck")}
    out = {
        "since": at, "away_s": int(away) if away is not None else None,
        "landed": sum(1 for t in now_marks.get("landed") or [] if t > at),
        "calls": sum(1 for k in now_marks.get("calls") or [] if k not in had["calls"]),
        "stuck": sum(1 for k in now_marks.get("stuck") or [] if k not in had["stuck"]),
    }
    out["any"] = bool(out["landed"] or out["calls"] or out["stuck"])
    return out


def _fold(text):
    return " ".join(str(text).lower().replace("-", " ").replace("_", " ").split())


def projects(items, machine_label=None):
    """Rows grouped by project first, machines second. items: the view's items with their host `row` (whose chip is the
    project) and `lane`. machine_label: {machine id: label} (ids are used where no label is known).

    -> (groups, order): groups is [{key, chip, n, off, waiting, machines: [id]}] by project name (case, hyphens and
    underscores fold), work with no project last; order is {(owner, id): [project rank, machine rank]} for the page to
    sort any list of rows by, before its own order (off course first, then the rest). The order depends only on names,
    never on states, so a project does not jump about as its work moves."""
    labels = machine_label or {}
    by = {}
    for it in items or []:
        chip = ((it.get("row") or {}).get("chip") or "").strip() or None
        k = _fold(chip) if chip else None
        g = by.setdefault(k, {"key": k, "chip": chip, "n": 0, "off": 0, "waiting": 0, "machines": set(), "items": []})
        g["n"] += 1
        cls = (it.get("lane") or {}).get("cls")
        g["off"] += cls in ("needs_action", "running_long")
        g["waiting"] += cls == "waiting"
        if it.get("machine"):
            g["machines"].add(it["machine"])
        g["items"].append(it)
    ordered = sorted(by.values(), key=lambda g: (g["key"] is None, g["key"] or "", g["chip"] or ""))
    mname = lambda m: _fold(labels.get(m) or m or "")
    groups, order = [], {}
    for pi, g in enumerate(ordered):
        ms = sorted(g["machines"], key=lambda m: (mname(m), m))
        rank = {m: i for i, m in enumerate(ms)}
        for it in g["items"]:
            order[(it.get("owner") or it.get("source"), it.get("id"))] = [pi, rank.get(it.get("machine"), len(ms))]
        groups.append({"key": g["key"], "chip": g["chip"], "n": g["n"], "off": g["off"], "waiting": g["waiting"], "machines": ms})
    return groups, order


def relative(at, now):
    """A time against now in plain words: 'just now' within a minute, '12 min ago' in the past, 'in 3 h 10 min' ahead.
    None when either time is missing."""
    if not isinstance(at, (int, float)) or not isinstance(now, (int, float)) or isinstance(at, bool):
        return None
    d = now - at
    if abs(d) < 60:
        return "just now"
    return gaps.ago(d) if d > 0 else gaps.until(-d)
