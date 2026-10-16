"""Black holes: what the board says about work that waits where nobody looks (feed 1.2, docs/feed-spec.md).

Pure functions: no I/O, no clock of their own (every time is passed in), nothing about any particular tool. The host
calls them while it builds the view and the page draws what they return:

    age_in_state      how long an item has been in its state, and what that age is measured from
    waits_outside     work held by someone outside the fleet (an upstream maintainer, a reviewer), oldest first
    queues            shared resources work waits its turn for, with the oldest wait on the host's clock
    coming_up         dated holds and rests that end soon, soonest first
    deploy_gaps       how far what is deployed is behind what is merged
    mirrors           each mirrored folder's one state word, from its sync job's receipt (feed 1.10)
    freshness         each source's collectors, with how old their answer is and whether that is too old
    pace              whether a source has stretched its own intervals on purpose (feed 1.4), and why
    span, ago, until  relative time in plain words
"""
import calendar
import time
from datetime import datetime, timezone

from . import lanes

WAIT_WORDS = {"external": "someone outside", "pr": "a review upstream"}
HELD = ("waiting", "paused")


def epoch(iso):
    """RFC 3339 UTC time ("...Z") -> epoch seconds; a date ("YYYY-MM-DD") -> its start in UTC; anything else -> None."""
    if not isinstance(iso, str):
        return None
    try:
        if len(iso) == 10:
            return float(calendar.timegm(time.strptime(iso, "%Y-%m-%d")))
        return float(calendar.timegm(time.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S")))
    except ValueError:
        return None


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v else None


# ---- relative time -----------------------------------------------------------------------------------------------
def span(s):
    """A length of time in plain words, at most two units: '45 s', '12 min', '3 h 10 min', '2 d 4 h'. None -> None."""
    s = _num(s)
    if s is None:
        return None
    s = max(0, int(round(s)))
    if s < 60:
        return "%d s" % s
    m = s // 60
    if m < 60:
        return "%d min" % m
    h, m = divmod(m, 60)
    if h < 24:
        return "%d h" % h + (" %d min" % m if m else "")
    d, h = divmod(h, 24)
    return "%d d" % d + (" %d h" % h if h else "")


def ago(s):
    """How long ago, in words a glance reads: 'just now' under a minute, else '12 min ago'."""
    s = _num(s)
    if s is None:
        return None
    return "just now" if s < 60 else span(s) + " ago"


def until(s):
    """How long until, in words: 'now' when it is due or past, else 'in 3 h 10 min'."""
    s = _num(s)
    if s is None:
        return None
    return "now" if s < 60 else "in " + span(s)


# ---- age in state ------------------------------------------------------------------------------------------------
def age_in_state(item, now):
    """-> {s, since, basis} or None: how long the item has been in its current state, from the best time the source
    gave. Bases, in order: `state_since` (1.2, what the source says), `waiting_since` (a held item), `handoff.since`
    (an approval), the current step's `waiting_since`, the last event when it reports this same state, and `started_at`
    for running work. Never a guess from the push time."""
    st = item.get("state")
    cur = ((item.get("progress") or {}).get("current") or {}) if isinstance(item.get("progress"), dict) else {}
    hand = item.get("handoff") or {}
    last = item.get("last_event") or {}
    tries = [("state_since", item.get("state_since"))]
    if st in HELD:
        tries.append(("waiting_since", item.get("waiting_since")))
    if hand.get("state") == "awaiting_you":
        tries.append(("handoff", hand.get("since")))
    tries.append(("step_waiting", cur.get("waiting_since")))
    if last.get("state") and last.get("state") == st:
        tries.append(("last_event", last.get("at")))
    if st == "running":
        tries.append(("started_at", item.get("started_at")))
    for basis, iso in tries:
        t = epoch(iso)
        if t is not None and t <= now + 60:
            return {"s": max(0, int(now - t)), "since": iso, "basis": basis}
    return None


# ---- outside waits -----------------------------------------------------------------------------------------------
def waits_outside(items, now):
    """Work held by someone outside the fleet, oldest first (one with no known start last): every lane the host
    classed `waiting` whose `waiting_on` is `external` or `pr`. -> [{id, source, owner, title, chip, waiting_on, who,
    since, age_s}]. `who` is the source's `waiting_for`, else a plain word for the kind of wait."""
    out = []
    for it in items:
        lane = it.get("lane") or {}
        if lane.get("cls") != "waiting" or lane.get("waiting_on") not in lanes.OUTSIDE:
            continue
        since = it.get("waiting_since") or it.get("state_since")
        t = epoch(since)
        if t is None:
            a = age_in_state(it, now)
            t, since = (now - a["s"], a["since"]) if a else (None, None)
        row = it.get("row") or {}
        who = it.get("waiting_for") if isinstance(it.get("waiting_for"), str) and it["waiting_for"].strip() else None
        out.append({"id": it.get("id"), "source": it.get("source"), "owner": it.get("owner"), "title": row.get("title") or it.get("title") or it.get("id"),
                    "chip": row.get("chip"), "waiting_on": lane["waiting_on"], "who": who or WAIT_WORDS[lane["waiting_on"]],
                    "since": since, "age_s": max(0, int(now - t)) if t is not None else None})
    out.sort(key=lambda w: (w["age_s"] is None, -(w["age_s"] or 0), str(w["id"])))
    return out


def oldest_waiting(items, now):
    """{s, id} for the item that has waited longest in a held class (waiting or needs_action), or None."""
    best = None
    for it in items:
        if (it.get("lane") or {}).get("cls") not in ("waiting", "needs_action"):
            continue
        a = age_in_state(it, now)
        if a and (best is None or a["s"] > best["s"]):
            best = {"s": a["s"], "id": it.get("id"), "source": it.get("source")}
    return best


# ---- queues ------------------------------------------------------------------------------------------------------
def queues(rows, now, slow_s=1800):
    """Each source's `queues[]` rows -> the board's queues, in a fixed order (machine, then label, then id).

    rows: [(queue, source id, received_at)]. A queue's `oldest_wait_s` is how long its oldest waiter had waited when
    the source built the feed (a delta on its own clock); the host adds the time since it received it, so a skewed
    clock never makes a wait look old or new. `oldest_since` is that start on the host's clock, for the page to keep
    counting. state: `clear` (nobody waits), `moving` (waiters, none for `slow_s`), `backed_up` (the oldest waited
    `slow_s` or more), `unknown` (no length). Never an alarm: a queue is said in words, not in amber."""
    out = []
    for q, sid, received in rows:
        if not isinstance(q, dict) or not q.get("id"):
            continue
        length, held, cap = _num(q.get("length")), _num(q.get("held")), _num(q.get("cap"))
        ow = _num(q.get("oldest_wait_s"))
        wait = ow + max(0.0, now - received) if ow is not None and length else None
        holders = []
        for h in q.get("holders") or []:
            if isinstance(h, dict):
                t = epoch(h.get("since"))
                holders.append({"label": h.get("label"), "since": h.get("since"), "s": max(0, int(now - t)) if t is not None else None})
        if length is None:
            state = "unknown"
        elif length <= 0:
            state = "clear"
        else:
            state = "backed_up" if wait is not None and wait >= slow_s else "moving"
        out.append({"id": q["id"], "source": sid, "label": q.get("label") or q["id"], "machine": q.get("machine"),
                    "length": int(length) if length is not None else None, "held": int(held) if held is not None else None,
                    "cap": int(cap) if cap is not None else None, "oldest_wait_s": int(wait) if wait is not None else None,
                    "oldest_since": (now - wait) if wait is not None else None, "holders": holders[:12], "state": state,
                    "as_of": q.get("as_of")})
    out.sort(key=lambda q: (str(q["machine"] or ""), str(q["label"]).lower(), str(q["id"]), str(q["source"])))
    return out


# ---- coming up ---------------------------------------------------------------------------------------------------
def _local_day_start(date_text, tz):
    try:
        d = datetime.strptime(date_text, "%Y-%m-%d")
    except ValueError:
        return None
    return d.replace(tzinfo=tz or timezone.utc).timestamp()


def coming_up(nxt, items, machines, now, tz=None, days=7):
    """Dated holds and rests that end within `days`, soonest first: queued work held until a date (`next[].until`),
    a held lane's `until`, a machine's declared rest `health.until`. A date (no time) means that day in the display
    time zone and stays listed through the whole day. -> [{at, date_only, kind (next|item|machine), id, source,
    title, word, date}] with `date` the calendar date when only a date was given (never moved by a time zone) and `word` the plain thing that happens: 'held until', 'wait ends', '<state> ends'."""
    out = []
    horizon = now + max(0, days) * 86400

    def when(text):
        if not isinstance(text, str):
            return None, False
        if len(text) == 10:
            t = _local_day_start(text, tz)
            return t, True
        return epoch(text), False

    def add(at, date_only, kind, id_, source, title, word, date=None):
        if at is None:
            return
        end = at + 86400 if date_only else at
        if end < now or at > horizon:
            return
        out.append({"at": at, "date_only": date_only, "date": date if date_only else None, "kind": kind, "id": id_, "source": source,
                    "title": title, "word": word})

    for n in nxt or []:
        at, d = when(n.get("until"))
        add(at, d, "next", n.get("id"), n.get("source"), n.get("title") or n.get("id"), "held_until", n.get("until"))
    for it in items or []:
        lane = it.get("lane") or {}
        if lane.get("cls") != "waiting" or not lane.get("until"):
            continue
        at, d = when(lane.get("until"))
        add(at, d, "item", it.get("id"), it.get("source"), (it.get("row") or {}).get("title") or it.get("title") or it.get("id"), "wait_ends", lane.get("until"))
    for m in machines or []:
        hl = m.get("health") or {}
        if hl.get("state") in ("reserved", "maintenance", "draining") and hl.get("until"):
            at, d = when(hl.get("until"))
            add(at, d, "machine", m.get("id"), hl.get("source"), m.get("label") or m.get("id"), hl["state"] + "_ends", hl.get("until"))
    out.sort(key=lambda c: (c["at"], c["kind"], str(c["id"])))
    return out


# ---- shipping gap ------------------------------------------------------------------------------------------------
def deploy_gaps(rows, now):
    """Each source's `deploys[]` -> how far what is deployed is behind what is merged. rows: [(deploy, source id)].
    state: `current` (nothing unshipped), `behind`, `unknown` (the source could not tell; `error` says why).
    `oldest_s` is how long the oldest unshipped merge has waited. Fixed order: label, then id."""
    out = []
    for d, sid in rows:
        if not isinstance(d, dict) or not d.get("id"):
            continue
        behind = _num(d.get("behind"))
        t = epoch(d.get("oldest_unshipped_at"))
        if d.get("error") or behind is None:
            state = "unknown"
        else:
            state = "behind" if behind > 0 else "current"
        out.append({"id": d["id"], "source": sid, "label": d.get("label") or d["id"], "group": d.get("group"),
                    "deployed": (d.get("deployed") or {}).get("version"), "deployed_at": (d.get("deployed") or {}).get("at"),
                    "head": (d.get("head") or {}).get("version"), "behind": int(behind) if behind is not None else None,
                    "oldest_unshipped_at": d.get("oldest_unshipped_at") if state == "behind" else None,
                    "oldest_s": max(0, int(now - t)) if t is not None and state == "behind" else None,
                    "state": state, "error": d.get("error"), "as_of": d.get("as_of")})
    out.sort(key=lambda d: (str(d["label"]).lower(), str(d["id"]), str(d["source"])))
    return out


# ---- the library: mirrored folders (1.10) ------------------------------------------------------------------------
# The closed set of words, worst first. Each has exactly one rule (docs/feed-spec.md, "Library"), and the first that
# holds wins: retired (a declaration), silent (the source), then the receipt's own fields.
MIRROR_STATES = ("failing", "not_checked", "silent", "unknown", "not_reporting", "waiting", "up_to_date", "retired")
MIRROR_OK = ("pushed", "nothing_new")
MIRROR_FAILED = ("push_failed", "fetch_failed", "merge_conflict", "scan_hit", "heal_failed", "no_clone", "shrink_refused", "error")


def folder(text):
    """A folder as a feed or the host config writes it, without leading or trailing slashes; None when there is none."""
    if not isinstance(text, str):
        return None
    return text.strip().strip("/") or None


def mirror_word(m, checked_s):
    """The word a row's own receipt fields support, on a live source: `failing` (the last run ended in a failure word),
    `not_checked` (the last run is older than the row's `stale_after_s`), `waiting` (files not yet in the repository, on a
    fresh receipt), `up_to_date` (a fresh receipt, a run that pushed or found nothing new, and nothing pending), else
    `unknown` (no run time, no limit, an outcome word this host does not know, or no pending count). `checked_s` is the
    age of `checked_at` on the host's clock."""
    pend = m.get("pending") if isinstance(m.get("pending"), dict) else {}
    n, limit = _num(pend.get("files")), _num(m.get("stale_after_s"))
    if m.get("outcome") in MIRROR_FAILED:
        return "failing"
    if checked_s is None or not limit:
        return "unknown"
    if checked_s > limit:
        return "not_checked"
    if n is not None and n > 0:
        return "waiting"
    if m.get("outcome") in MIRROR_OK and n == 0:
        return "up_to_date"
    return "unknown"


def mirrors(rows, now, expected=None, retired=None):
    """Each source's `mirrors[]` -> one row per mirrored folder with the one word its fields support, worst first.

    rows: [(mirror, source id, machine, generated_at, received_at, silent)], where `silent` says the source itself is stale or
    lost (its `received_at` against its own `interval_s`, the existing rule). Every time a receipt carries is the source's own
    clock; it is moved to the host's by the source's offset (`received_at - generated_at`), so `at` holds host-clock epochs the
    page counts on and `checked_s` is the run's age now. `expected` lists folders the host config says some source should
    report (one that none does reads `not_reporting`); `retired` lists `{ns, since, note}` declared in the host config (the
    only other way to `retired` is the row's own `retired: true`; age never retires a folder). A silent source's row reads
    `silent` and keeps the word it had as `last_known`. -> [{id, source, machine, ns, label, repo, state, last_known, outcome,
    detail, pending, nothing_new, checked_s, limit_s, checked_at, changed_at, changed_sha, failing_since, pending_since, at,
    since, note, as_of}]"""
    declared = {}
    for r in retired or []:
        ns = folder(r.get("ns") if isinstance(r, dict) else r)
        if ns:
            r = r if isinstance(r, dict) else {}
            declared[ns] = {"since": r.get("since") if isinstance(r.get("since"), str) else None,
                            "note": r.get("note") if isinstance(r.get("note"), str) else None}
    out = []
    for m, sid, machine, generated_at, received_at, silent in rows:
        if not isinstance(m, dict) or not m.get("id"):
            continue
        gen = epoch(generated_at)
        off = received_at - gen if gen is not None and received_at is not None else 0.0

        def on_host(iso):
            t = epoch(iso)
            return t + off if t is not None else None

        pend = m.get("pending") if isinstance(m.get("pending"), dict) else {}
        checked = on_host(m.get("checked_at"))
        checked_s = max(0, int(now - checked)) if checked is not None else None
        word, last = mirror_word(m, checked_s), None
        if silent:
            word, last = "silent", word
        ns = folder(m.get("ns"))
        dec = declared.get(ns) if ns else None
        if dec or m.get("retired") is True:
            word, last = "retired", None
        n, limit = _num(pend.get("files")), _num(m.get("stale_after_s"))
        out.append({"id": m["id"], "source": sid, "machine": machine, "ns": ns, "label": m.get("label") or (ns + "/" if ns else m["id"]),
                    "repo": m.get("repo"), "state": word, "last_known": last, "outcome": m.get("outcome"), "detail": m.get("detail"),
                    "pending": int(n) if n is not None else None, "nothing_new": m.get("outcome") == "nothing_new",
                    "checked_s": checked_s, "limit_s": int(limit) if limit else None,
                    "checked_at": m.get("checked_at"), "changed_at": m.get("changed_at"), "changed_sha": m.get("changed_sha"),
                    "failing_since": m.get("failing_since"), "pending_since": pend.get("since"),
                    "at": {"checked": checked, "changed": on_host(m.get("changed_at")), "failing": on_host(m.get("failing_since")),
                           "pending": on_host(pend.get("since"))},
                    "since": (dec or {}).get("since"), "note": (dec or {}).get("note"), "as_of": m.get("as_of")})
    reported = {r["ns"] for r in out if r["ns"]}
    named = [folder(e.get("ns") if isinstance(e, dict) else e) for e in expected or []]
    for ns in dict.fromkeys([n for n in named if n] + list(declared)):   # in the order the config lists them, once each
        if ns in reported:
            continue
        dec = declared.get(ns)
        out.append({"id": ns, "source": None, "machine": None, "ns": ns, "label": ns + "/", "repo": None,
                    "state": "retired" if dec else "not_reporting", "last_known": None, "outcome": None, "detail": None, "pending": None,
                    "nothing_new": False, "checked_s": None, "limit_s": None, "checked_at": None, "changed_at": None, "changed_sha": None,
                    "failing_since": None, "pending_since": None, "at": {"checked": None, "changed": None, "failing": None, "pending": None},
                    "since": (dec or {}).get("since"), "note": (dec or {}).get("note"), "as_of": None})
    rank = {w: i for i, w in enumerate(MIRROR_STATES)}
    out.sort(key=lambda r: (rank.get(r["state"], len(rank)), str(r["label"]).lower(), str(r["id"]), str(r["source"] or "")))
    return out


# ---- collector freshness -----------------------------------------------------------------------------------------
def freshness(collectors, generated_at, received_at, now, limits=None, interval_s=30):
    """A source's collectors with how old each answer is on the host's clock: its age when the source built the feed
    (generated_at - as_of, one clock) plus the time since the host received it. `limit_s` is the collector's own
    `stale_after_s` (1.2), else the host's `collector_stale_s` for its id, else none. state: `ok`, `old` (past its
    limit or said stale), `error`. 1.12: a collector that says when its copy was made (`made_at`, its maker's own stamp) is aged
    from that instead of `as_of`, so a copy re-read or re-touched without being remade still ages (`made: true`); with no limit
    of its own, its limit is twice its maker's `refresh_s`. -> [{id, label, age_s, limit_s, state, error, made, refresh_s}]"""
    out = []
    gen = epoch(generated_at)
    since = max(0.0, now - received_at) if received_at is not None else 0.0
    for c in collectors or []:
        if not isinstance(c, dict) or not c.get("id"):
            continue
        made = epoch(c.get("made_at"))
        a = made if made is not None else epoch(c.get("as_of"))
        age = None if received_at is None else (max(0.0, gen - a) if gen is not None and a is not None else 0.0) + since
        refresh = _num(c.get("refresh_s"))
        limit = _num(c.get("stale_after_s")) or _num((limits or {}).get(c["id"])) or (2 * refresh if made is not None and refresh else None)
        state = "error" if c.get("status") == "error" else "old" if c.get("status") == "stale" or (limit and age is not None and age > limit) else "ok"
        out.append({"id": c["id"], "label": c.get("label") or c["id"], "age_s": int(age) if age is not None else None,
                    "limit_s": int(limit) if limit else None, "state": state, "error": c.get("error"),
                    "made": made is not None, "refresh_s": int(refresh) if refresh else None})
    return out


# ---- pace ----------------------------------------------------------------------------------------------------------
def pace(block, now):
    """A source's `pace` (feed 1.4) as the view says it, or None when the source sends none (then the board says nothing about
    its pace). `slowed` is the source's own factor above 1: it has stretched its intervals on purpose, for the reasons in `why`;
    the board then says "slowed on purpose", never "silent", and its answers are as old as that pace makes them. A factor below
    1 cannot be true and counts as 1. `since_s` is how long it has been slowed, on the host's clock. Every figure is the
    source's own, or None: the host works out none of them."""
    if not isinstance(block, dict) or _num(block.get("factor")) is None:
        return None
    factor = max(1.0, float(block["factor"]))
    cost = block.get("cost") if isinstance(block.get("cost"), dict) else {}
    since = epoch(block.get("since")) if factor > 1 else None
    why = block.get("why") if isinstance(block.get("why"), list) else []
    return {"slowed": factor > 1, "factor": factor, "why": [w for w in why if isinstance(w, str)][:6] if factor > 1 else [],
            "since_s": int(max(0.0, now - since)) if since is not None else None,
            "pass_s": _num(block.get("pass_s")), "normal_pass_s": _num(block.get("normal_pass_s")),
            "keepalive_s": _num(block.get("keepalive_s")), "normal_keepalive_s": _num(block.get("normal_keepalive_s")),
            "load_per_core": _num(block.get("load_per_core")),
            "on_battery": block.get("on_battery") if isinstance(block.get("on_battery"), bool) else None,
            "cost": {k: _num(cost.get(k)) for k in ("cpu_s_per_h", "budget_cpu_s_per_h", "run_s", "budget_run_s", "measured_s")}
                    | {"over_budget": cost.get("over_budget") if isinstance(cost.get("over_budget"), bool) else None}}


def days_ahead(at, now, tz=None):
    """0 today, 1 tomorrow, ... in the display time zone (for 'Tue' versus '14:00')."""
    z = tz or timezone.utc
    return (datetime.fromtimestamp(at, z).date() - datetime.fromtimestamp(now, z).date()).days


