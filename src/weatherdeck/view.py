"""Build the merged view served at /api/view from every source's last accepted feed.

Nothing here names a machine, source or item: everything is discovered from the feeds.
Staleness is not decided here (the browser does it per source from received_at and the host's
Date header); the only time-dependent choice made on the host is preferring a source's own copy
of an item over a relayed copy while that source has reported within lost_after_s.
"""
import hashlib
import json
import os
import re
import time
from datetime import datetime, timedelta

from . import allowance, cards, config, debounce, fleet, gaps, glance, goals, lanes, norms, schema, skew, store
from .ingest import norm_id

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

_SALT = os.urandom(8).hex()
_SEVERITY_RANK = {"critical": 2, "action": 1, "info": 0}
# Machine states a source declares or the host derives. Declared rest (maintenance, reserved) wins while it holds: a machine
# under maintenance is expected not to answer. Only lost gets a card; draining, reserved and maintenance are shown neutral.
_HEALTH_RANK = {"maintenance": 4, "reserved": 3, "lost": 2, "draining": 1}
NEUTRAL = ("maintenance", "reserved", "draining")
_CALL_ID = re.compile(r"^(hold|contrib):([^/]+)/(.+)$")  # a home's call about one task: <kind>:<owning home>/<task>[:<key>]
_STATUS_RANK = {"down": 3, "warn": 2, "unknown": 1, "ok": 0}
_PRESSURE_RANK = {"critical": 2, "warn": 1, "ok": 0}
_STATION_KEYS = ("status", "as_of", "reach", "load", "mem", "io", "pressure", "beat", "health", "disks", "uptime_s", "on_battery", "extras")


def _slug(text):
    out = "".join(c if c.isalnum() else "-" for c in str(text).lower()).strip("-")
    return "-".join(p for p in out.split("-") if p)[:48] or "station"


def machine_aliases(cfg):
    """{reported machine id: (machine id, station label)} from config machines.aliases: an id an older install still
    reports folds into the machine it really is, as that machine's station (the alias id itself when none is named)."""
    out = {}
    for old, to in ((cfg.get("machines") or {}).get("aliases") or {}).items():
        if isinstance(to, str):
            out[old] = (to, old)
        elif isinstance(to, dict) and isinstance(to.get("machine"), str):
            out[old] = (to["machine"], to.get("station") or old)
    return out


def _iso(epoch):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch))


def _tzinfo(name):
    if name and ZoneInfo:
        try:
            return ZoneInfo(name)
        except Exception:
            return None
    return None


def _day(ts, tz):
    return datetime.fromtimestamp(ts, tz).strftime("%Y-%m-%d")


def _hm(text):
    try:
        hh, mm = str(text).split(":")
        return int(hh) * 60 + int(mm) if 0 <= int(hh) < 24 and 0 <= int(mm) < 60 else None
    except (ValueError, AttributeError):
        return None


def landed_window(now, display, tz):
    """{mode, since, hours, day_start}: what "landed" counts. A rolling window (default 24 h) never reads 0 just after
    midnight; with display.landed.day_start ("HH:MM") it counts since the last time the day started at that hour."""
    lw = display.get("landed") or {}
    start = _hm(lw.get("day_start")) if lw.get("day_start") else None
    if start is None:
        hours = max(1, min(168, int(lw.get("window_hours") or 24)))
        return {"mode": "rolling", "since": now - hours * 3600, "hours": hours, "day_start": None}
    local = datetime.fromtimestamp(now, tz)
    mark = local.replace(hour=start // 60, minute=start % 60, second=0, microsecond=0)
    if mark > local:
        mark -= timedelta(days=1)
    return {"mode": "day", "since": mark.timestamp(), "hours": None, "day_start": lw.get("day_start")}


def _expired(health, now):
    """A declared state with an `until` that has passed no longer holds."""
    until = health.get("until")
    if not isinstance(until, str):
        return False
    try:
        end = schema.parse_time(until) if "T" in until else schema.parse_time(until + "T23:59:59Z")
    except ValueError:
        return False
    return end < now


def history_view(conn, now, sample):
    cfg = config.get()
    h = cfg["history"]
    tz = _tzinfo(cfg["display"]["tz"])
    win = landed_window(now, cfg["display"], tz)
    # Days for the chart begin at the configured day start (midnight without one).
    shift = (_hm((cfg["display"].get("landed") or {}).get("day_start")) or 0) * 60
    today = datetime.fromtimestamp(now - shift, tz).date()
    start = datetime.combine(today - timedelta(days=h["by_day"] - 1), datetime.min.time(), tz).timestamp() + shift
    by_day = {(today - timedelta(days=i)).isoformat(): {} for i in range(h["by_day"])}
    done_today = 0
    for r in conn.execute("SELECT grp, at FROM done WHERE at >= ? AND sample = ?", (min(start, win["since"]), sample)):
        d = _day(r["at"] - shift, tz)
        if d in by_day:
            g = r["grp"] or "other"
            by_day[d][g] = by_day[d].get(g, 0) + 1
        if win["since"] <= r["at"] <= now + 60:
            done_today += 1
    timeline = [
        {"at": r["at"], "owner": r["owner"], "item": r["item"], "group": r["grp"], "kind": r["kind"], "text": r["text"]}
        for r in conn.execute("SELECT * FROM events WHERE at >= ? AND sample = ? ORDER BY at DESC LIMIT 30",
                              (now - h["timeline_hours"] * 3600, sample))
    ]
    # Notes: one-off words a source left for the Logbook (events[].kind "note": a missing optional feature, a setup hint),
    # never a standing card. The newest few per source.
    notes, per = [], {}
    for r in conn.execute("SELECT * FROM events WHERE kind = 'note' AND sample = ? ORDER BY at DESC LIMIT 60", (sample,)):
        if per.get(r["source_id"], 0) < 5:
            per[r["source_id"]] = per.get(r["source_id"], 0) + 1
            notes.append({"at": r["at"], "source": r["source_id"], "item": r["item"], "text": r["text"]})
    return {"tz": cfg["display"]["tz"], "done_today": done_today, "landed": dict(win, n=done_today),
            "by_day": [{"day": d, "done": by_day[d]} for d in sorted(by_day)], "timeline": [e for e in timeline if e["kind"] != "note"],
            "notes": notes[:20]}


def _push_stats(conn, now):
    since = now - 86400
    per = {}
    for r in conn.execute("SELECT source_id, COUNT(*) n, COALESCE(SUM(gap),0) g FROM pushes WHERE received_at>=? AND status='ok' GROUP BY source_id", (since,)):
        per[r["source_id"]] = (r["n"], r["g"])
    return per


def _opaque(x):
    return None if x is None else "x-" + hashlib.sha256((_SALT + str(x)).encode()).hexdigest()[:8]


def _hide_machine_detail(view):
    """What machines and sources say about themselves in prose: gone from every redacted view."""
    for m in [x for mm in view["machines"] for x in [mm, *(mm.get("stations") or [])]]:
        m["extras"] = []
        if m.get("health"):
            m["health"]["reason"] = None
        if m.get("beat"):
            m["beat"]["errors"] = []
        if m.get("reach"):
            m["reach"]["error"] = None
    for s in view["sources"]:
        s["boot_id"] = None
        if s.get("producer"):
            s["producer"] = dict(s["producer"], host=None)   # a computer's own name, as it calls itself, is not a machine label
        s["collectors"] = [dict(c, error=None) for c in s.get("collectors") or []]
        s["freshness"] = [dict(f, error=None) for f in s.get("freshness") or []]   # the same words, as the host aged them
        if s.get("waiting"):
            s["waiting"] = dict(s["waiting"], reason=None)
        if s.get("rejected"):
            s["rejected"] = dict(s["rejected"], reason="rejected")


def _hold_words(row):
    """1.12: a hold's reason is the holder's own words; its bucket and dates stay."""
    if isinstance(row.get("hold"), dict):
        row["hold"] = dict(row["hold"], reason=None)


def machine_lanes(by_source, with_items, silent=()):
    """1.12: a machine's lanes, every source's own count on it added up, so two homes on one machine are one count. `by_source` is
    {source: {running, total}} as each sent it; `with_items` the sources with any lane on this machine in the view. A source with lanes
    here that sent no count is `unreported`, as is a `silent` source (one past the host's silence limit: its last count is not summed), and a count it left out makes the sum `or_more`: a sum is never said as more than it is.
    -> None when no source sends a count (the board then says nothing new), else {running, total, homes[], unreported[], or_more}."""
    if not by_source:
        return None
    num = lambda v: v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else None
    by_source = {s: v for s, v in by_source.items() if s not in silent}
    run = [num(v.get("running")) for v in by_source.values()]
    tot = [num(v.get("total")) for v in by_source.values()]
    unreported = sorted((set(with_items) | set(silent)) - set(by_source))
    return {"running": sum(x for x in run if x is not None), "total": sum(tot) if None not in tot else None,
            "homes": sorted(by_source), "unreported": unreported, "or_more": None in run or bool(unreported)}


def redact(view, level, labels):
    """Strip what a profile may not show, on the host, before the view is cached or sent.

    household: for a screen the household can see. Item and group titles, repo (group) names, ids
               and pull-request links stay; free text a worker wrote about what it is doing
               (details, state text, last events, attention details and recommendations, gate notes, failing test
               names) and everything machines say about themselves in prose is stripped.
    guest:     titles, details, links and ids; group and machine names stay.
    public:    guest, plus step labels, flags, queue and done rows, attention text, machine extras,
               timeline text and error texts. What is left is counts, names of groups and machines,
               states, percent ranges and ages.
    """
    view["cards"] = cards.redact(view["cards"], level)
    if level != "none":
        view["cards_rejected"] = 0
        for s in view["sources"]:
            if s.get("producer"):
                s["producer"] = dict(s["producer"], host=None)
    if level == "household":
        for it in view["items"]:
            it["doing"], it["state_detail"], it["last_event"], it["summary"] = None, None, None, None
            if it.get("row"):
                it["row"] = dict(it["row"], summary=None)
            rep = it.get("reported")
            if rep:
                it["reported"] = dict(rep, label=None)
            (it.get("progress") or {})["reason"] = None
        for a in view["attention"] + view["attention_pending"]:
            a["detail"], a["recommend"], a["say"], a["answer_link"] = None, None, None, None   # 1.6: the answer address is the full profile's
            a.pop("options", None)   # 1.9: so are the choices
            _hold_words(a)
        for n in view["next"]:
            n["reason"] = None
            _hold_words(n)
        for g in view["groups"]:
            gate = (g.get("checkpoint") or {}).get("gate")
            if gate:
                gate["note"], gate["failing"] = None, None
        for it in view["items"]:
            if it.get("agent"):
                it["agent"] = dict(it["agent"], reason=None)
        for d in view["gaps"]["deploys"]:
            d["error"] = None
        for r in view["gaps"].get("mirrors") or []:   # 1.10: the folder, its word and its ages stay; the receipt's words and the retirement note go
            r["detail"], r["note"] = None, None
        _hide_machine_detail(view)
        return
    generic, alert = labels.get("guest_item", "Work item"), labels.get("guest_attention", "Something needs you")
    public = level == "public"
    view["goals"] = []   # a goal's name is the owner's own words, like a title: a guest sees the lanes, not the goal they serve
    for row in view["items"] + view["next"] + view["done"]:
        row.pop("goal", None)
    for it in view["items"]:
        it["id"], it["title"], it["doing"], it["state_detail"], it["link"] = _opaque(it["id"]), generic, None, None, None
        it["last_event"], it["summary"] = None, None
        if it.get("source_lane"):
            it["source_lane"] = dict(it["source_lane"], short_title=None)
        if it.get("say"):   # a title another lane waits for is a title
            it["say"] = [{k: v for k, v in c.items() if k != "title"} for c in it["say"] if isinstance(c, dict)]
        if it.get("row"):
            it["row"] = dict(it["row"], title=generic, summary=None)
        rep = it.get("reported")
        if rep:
            it["reported"] = {"percent": rep.get("percent"), "basis": rep.get("basis"), "at": rep.get("at"), "label": None}
        if public:
            it["flags"] = []
            prog = it.get("progress") or {}
            prog["reason"] = None
            for i, st in enumerate(prog.get("steps") or []):
                st["id"], st["label"] = str(i + 1), labels.get("step_generic", "Step {n}").replace("{n}", str(i + 1))
            cur = prog.get("current")
            if cur and cur.get("step") is not None:
                steps = prog.get("steps") or []
                cur["step"] = next((st["id"] for st in steps if st.get("status") == "current"), None)
    for d in view.get("waiting_disagree") or []:
        d["item"], d["call"] = _opaque(d["item"]), _opaque(d["call"])
    for a in view["attention"] + view["attention_pending"]:
        a["id"], a["title"], a["detail"], a["how"], a["link"], a["item"] = _opaque(a["id"]), alert, None, None, None, _opaque(a.get("item"))
        a["recommend"], a["say"], a["answer_link"] = None, None, None
        a.pop("options", None)
        _hold_words(a)
        if isinstance(a.get("actor"), dict):
            a["actor"] = dict(a["actor"], name=None)
        if isinstance(a.get("verdict"), dict):
            a["verdict"] = dict(a["verdict"], name=None)
    for s in view["sources"]:
        if (s.get("waiting") or {}).get("note") is not None:
            s["waiting"] = dict(s["waiting"], note=_opaque(s["waiting"]["note"]))
    for n in view["next"]:
        n["id"], n["title"], n["reason"] = _opaque(n["id"]), generic, None
        _hold_words(n)
        n["blocked_by"] = [_opaque(b) for b in n.get("blocked_by") or []]
    for d in view["done"]:
        d["id"], d["title"], d["link"] = _opaque(d["id"]), generic, None
    for g in view["groups"]:
        cp = g.get("checkpoint")
        if cp and cp.get("next"):
            cp["next"]["waiting_on"] = [_opaque(w) for w in cp["next"].get("waiting_on") or []]
        if cp and cp.get("gate"):
            cp["gate"]["note"], cp["gate"]["failing"] = None, None
            if public:
                cp["gate"]["sha"], cp["gate"]["ship"] = None, None
    holes = view["gaps"]
    for w in holes["waits_outside"]:
        w["id"], w["owner"], w["title"], w["who"] = _opaque(w["id"]), None, generic, labels.get("guest_outside", "someone outside")
    if holes["oldest_waiting"]:
        holes["oldest_waiting"]["id"] = _opaque(holes["oldest_waiting"]["id"])
    for q in holes["queues"]:
        q["holders"] = [dict(h, label=None) for h in q["holders"]]
    for c in holes["coming_up"]:
        if c["kind"] != "machine":
            c["id"], c["title"] = _opaque(c["id"]), generic
    for d in holes["deploys"]:
        d["error"] = None
        if public:
            d["deployed"], d["head"] = None, None
    for r in holes.get("mirrors") or []:
        r["detail"], r["note"] = None, None
    if public:
        holes["mirrors"] = []   # the library row is the full and household views' only
    for it in view["items"]:
        it["waiting_for"] = None
        if it.get("agent"):
            it["agent"] = dict(it["agent"], reason=None)
    for e in view["history"]["timeline"]:
        e["text"], e["item"] = generic, _opaque(e["item"])
    for e in view["history"].get("notes") or []:
        e["item"] = _opaque(e["item"])
    if public:
        view["next"], view["done"] = [], []
        view["history"]["timeline"], view["history"]["notes"] = [], []
        _hide_machine_detail(view)


def owned_call_keys(feeds):
    """{(kind, owner, task)} and {(kind, task)} for every call a source lists under its own name (hold:<its id>/<task>)."""
    out = set()
    for sid, f in feeds.items():
        for a in f["feed"]["attention"]:
            m = _CALL_ID.match(str(a["id"]))
            if m and m.group(2) == sid:
                out.add((m.group(1), sid, m.group(3)))
                out.add((m.group(1), m.group(3)))
    return out


def relayed_copy_dropped(sid, call_id, feeds, known, owned_calls):
    """True when `sid`'s card for `call_id` is a second-hand copy of another home's call that is not the one to count: the
    owner is named by something that is no source and some source lists the same call as its own, or the owner reports and its own feed no longer lists the id (it answered and dropped the call, so the
    relaying home's older copy must not keep it on the board). A copy whose owner still lists it merges as one card by id."""
    m = _CALL_ID.match(str(call_id))
    if not m or m.group(2) == sid:
        return False
    if m.group(2) not in known:
        return (m.group(1), m.group(3)) in owned_calls
    return m.group(2) in feeds and (m.group(1), m.group(2), m.group(3)) not in owned_calls


# 1.12: the roles a card's `actor` may name that are not the viewer's turn; any other word (or none) leaves the card as it was
NOT_VIEWER = ("supervisor", "worker", "external")


def aside(row, now):
    """Whether a card or a queued row is set aside from the viewer's asks (feed 1.12), on the host's clock: "deferred" while the viewer's
    dated hold holds (`hold.bucket` "dated" and an `until` that has not passed; a date holds through that whole day), "theirs" when its
    `actor.role` says it is someone else's turn, else None. A hold with no readable date, a passed date or an unknown role is None: an
    ask is never set aside on a guess."""
    hold = row.get("hold") if isinstance(row.get("hold"), dict) else {}
    if hold.get("bucket") == "dated" and isinstance(hold.get("until"), str) and not _expired(hold, now):
        try:
            schema.parse_time(hold["until"] if "T" in hold["until"] else hold["until"] + "T00:00:00Z")
            return "deferred"
        except ValueError:
            pass
    actor = row.get("actor") if isinstance(row.get("actor"), dict) else {}
    return "theirs" if actor.get("role") in NOT_VIEWER else None


def is_call(a):
    """A call waits on the viewer: an attention card that is neither critical (a problem, shown on its own line) nor info (an FYI),
    and that the host has not set aside (1.12 `aside`: deferred by the viewer, or someone else's turn)."""
    return a.get("severity") not in ("info", "critical") and not a.get("aside")


def waits_for_ok(it):
    """The lane says it waits for the viewer's OK (`handoff.state: awaiting_you`) and its pull request is open."""
    return (it.get("handoff") or {}).get("state") == "awaiting_you" and (it.get("link") or {}).get("state") == "open"


def waits_on_viewer(it):
    """The lane says it waits on the viewer by any route: its source set `needs_you`, or it waits for the viewer's OK
    (`handoff.state: awaiting_you`) with its pull request open or of a state the source does not report."""
    return bool(it.get("needs_you")) or ((it.get("handoff") or {}).get("state") == "awaiting_you"
                                         and (it.get("link") or {}).get("state") in (None, "open"))


def reports_no_wait(it):
    """The lane reports that it does not wait on the viewer: it finishes by itself or is complete, or it waited for the viewer's OK
    and its pull request is reported as no longer open."""
    h, pr = (it.get("handoff") or {}).get("state"), (it.get("link") or {}).get("state")
    return h in ("automatic", "complete") or (h == "awaiting_you" and pr not in (None, "open"))


def call_names_lane(a, it):
    """Whether a call and a lane are one ask. A call with an `item` names the lane it gives as `<owner>/<id>`, or as the bare id when
    the call comes from the lane's own source or is a call about the lane's owner (`hold:<owner>/...`, `contrib:<owner>/...`). A call
    with no `item` names the lane whose `link.url` is the call's own."""
    homes = {it.get("owner"), it.get("source")} - {None}
    item = a.get("item")
    if item is not None:
        item, lid = str(item), str(it.get("id"))
        if any(item == f"{h}/{lid}" for h in homes):
            return True
        m = _CALL_ID.match(str(a.get("id") or ""))
        return item == lid and bool(homes & {a.get("source"), m.group(2) if m else None})
    url = (a.get("link") or {}).get("url")
    return bool(url) and url == (it.get("link") or {}).get("url")


def lane_asks(attention, items):
    """The lanes that are asks of their own, and where the calls and the lanes disagree. A lane that waits for the viewer's OK
    (`waits_for_ok`) and that no call names is one ask, drawn on its own line with its own reason; a call that names it absorbs it,
    so one ask is one line. The two lists are two reports of what waits on the viewer: the calls, from the source that raised them,
    and the lanes that say they wait. Each lane no call names is a difference; so is each call that names lanes none of which waits on
    the viewer by any route (`waits_on_viewer`) when a named lane comes from another source than the call or reports that it does
    not wait (`reports_no_wait`). Run it on the lanes as their sources sent them, before a call marks them `needs_you`.
    -> (asks: [item], disagree: [{kind: "lane"|"call", item, item_source, call, call_source}])."""
    calls = [a for a in attention or [] if is_call(a)]
    # A card set aside (deferred, or someone else's turn) that names a lane takes the lane aside with it: never an ask of its own.
    holders = calls + [a for a in attention or [] if a.get("aside") and a.get("severity") != "critical"]
    asks, disagree = [], []
    for it in items or []:
        if waits_for_ok(it) and not any(call_names_lane(a, it) for a in holders):
            asks.append(it)
            disagree.append({"kind": "lane", "item": it.get("id"), "item_source": it.get("source"), "call": None, "call_source": None})
    for a in calls:
        named = [it for it in items or [] if call_names_lane(a, it)]
        if not named or any(waits_on_viewer(it) for it in named):
            continue
        odd = [it for it in named if it.get("source") != a.get("source") or reports_no_wait(it)]
        if odd:
            disagree.append({"kind": "call", "item": odd[0].get("id"), "item_source": odd[0].get("source"), "call": a.get("id"),
                             "call_source": a.get("source")})
    return asks, disagree


def waiting_on_you(attention, items=()):
    """The asks that wait on the viewer, one row per ask: the board's one waiting-on-you number is their count, the same on the
    call band, the Lists header, the Bridge door and the ship plates (web/frontdoor.js `cardTier`, `askRows`). The calls (`is_call`;
    a problem or an FYI is never counted), then the lanes that are asks of their own (`lane_asks`).
    -> [{"tier": "call"|"lane", "source", "id"}]."""
    return ([{"tier": "call", "source": a.get("source"), "id": a.get("id")} for a in attention or [] if is_call(a)]
            + [{"tier": "lane", "source": it.get("source"), "id": it.get("id")} for it in lane_asks(attention, items)[0]])


def build(now=None, redaction="none"):
    now = now or time.time()
    cfg = config.get()
    th = cfg["thresholds"]
    feeds = store.load_source_feeds()
    conn = store.connect()
    try:
        rows = {r["id"]: r for r in conn.execute("SELECT * FROM sources")}
        pushes = _push_stats(conn, now)
        rejected = {}
        for p in store.rejected_dir().glob("*.json"):
            rejected[p.stem] = store.read_json(p)

        def age(sid):
            return now - feeds[sid]["received_at"] if sid in feeds else None

        # ---- sources and placeholders -------------------------------------------------------
        aliases = machine_aliases(cfg)
        canon = lambda mid: aliases[mid][0] if mid in aliases else mid
        sources, known = [], set(feeds) | set(rows)
        for sid in sorted(known):
            doc = feeds.get(sid)
            feed = doc["feed"] if doc else {}
            src = feed.get("source") or {}
            row = rows.get(sid)
            n, g = pushes.get(sid, (0, 0))
            sent = src.get("machine") or (row["machine"] if row else None)
            station = src.get("station") or (aliases[sent][1] if sent in aliases else None)
            sources.append({
                "id": sid, "label": src.get("label") or sid, "machine": canon(sent) if sent else None, "station": station,
                "kind": src.get("kind"), "peers": src.get("peers") or [],
                "received_at": doc["received_at"] if doc else (row["last_received"] if row else None),
                "interval_s": feed.get("interval_s") or (row["interval_s"] if row else None) or th["default_interval_s"],
                # whether `interval_s` is the source's own word (the feed declares it) or the host's default standing in for it
                "interval_declared": bool(feed.get("interval_s")),
                "mode": (feed.get("producer") or {}).get("mode"), "boot_id": (feed.get("producer") or {}).get("boot_id"),
                "seq": (feed.get("producer") or {}).get("seq"),
                "skew_s": (round(doc["received_at"] - schema.parse_time(feed["generated_at"]), 1)
                           if doc and feed.get("generated_at") else None),
                "generated_at": feed.get("generated_at"),
                "collectors": feed.get("collectors") or [], "rejected": rejected.get(sid),
                "pushes_24h": n, "gaps_24h": g, "placeholder": False,
                "waiting": feed.get("waiting") if isinstance(feed.get("waiting"), dict) else None,
                # 1.3: the software it reported (None when it never reported a feed; every part None when it did not say)
                "producer": skew.producer_of(feed) if doc else None, "skew": [],
                # 1.2 views: how old each collector's answer is on the host's clock, and whether that is too old
                # 1.4 views: whether the source has slowed its own intervals on purpose, and why
                "pace": gaps.pace(feed.get("pace"), now) if doc else None,
                "freshness": gaps.freshness(feed.get("collectors") or [], feed.get("generated_at"), doc["received_at"] if doc else None,
                                            now, th.get("collector_stale_s"), feed.get("interval_s") or th["default_interval_s"]) if doc else [],
            })

        # Versions: a source is flagged only where an older version than a change's `since` runs beside one that has it.
        flagged = skew.assess([dict(source=s["id"], name=(s["producer"] or {}).get("name"), version=(s["producer"] or {}).get("version"),
                                    meaning=(s["producer"] or {}).get("meaning")) for s in sources])
        for s in sources:
            s["skew"] = flagged.get(s["id"], [])
            if s["producer"]:
                s["producer"] = {k: v for k, v in s["producer"].items() if k != "meaning"}

        # ---- items: union, deduped by (owner, id), the owner's own copy preferred ----------------
        # A relayed copy names its owner as the relaying home knows it; when that name is no source at all (a folder name)
        # and exactly one source reports the same id as its own work, it is that source's lane, counted once.
        first_hand = {}
        for sid, doc in feeds.items():
            for it in doc["feed"]["items"]:
                if (it.get("owner") or sid) == sid:
                    first_hand.setdefault(norm_id(sid, it["id"]), set()).add(sid)
        cands, alias = {}, {}
        for sid, doc in feeds.items():
            for it in doc["feed"]["items"]:
                owner = it.get("owner") or sid
                real = first_hand.get(norm_id(owner, it["id"]), ())
                if owner != sid and owner not in known and len(real) == 1:
                    alias[owner] = next(iter(real))
                    owner = alias[owner]
                cands.setdefault((owner, norm_id(owner, it["id"])), []).append((sid, owner, it))
        items = []
        for (owner, iid), lst in cands.items():
            own = [c for c in lst if c[0] == owner]
            other = [c for c in lst if c[0] != owner]
            if own and (age(owner) or 0) <= th["lost_after_s"]:
                pick, second = own[0], False
            elif other:
                pick, second = max(other, key=lambda c: feeds[c[0]]["received_at"]), True
            else:
                pick, second = own[0], False
            sid, _, it = pick
            it = dict(it)
            it.update(source=sid, owner=owner, second_hand=second, id=iid)
            if not it.get("machine") and not second:
                it["machine"] = (feeds[sid]["feed"]["source"].get("machine"))
            elif not it.get("machine") and owner in feeds:   # a relayed copy runs where its owner does
                it["machine"] = feeds[owner]["feed"]["source"].get("machine")
            if it.get("machine"):
                it["machine"] = canon(it["machine"])
            items.append(it)

        # ---- machines: one per physical machine, its sources' views of it as stations -----------------
        # A source says which part of its machine it reports (source.station: the Windows host, a Linux guest). Rows for
        # one machine id from different stations stay apart as stations[]; the machine itself shows the worst of them.
        machines, reported, by_station, named, lanes_by = {}, {}, {}, {}, {}
        src_of = {s["id"]: s for s in sources}
        own_machine = {s["id"]: s["machine"] for s in sources if s["machine"]}
        for sid, doc in feeds.items():
            for m0 in doc["feed"]["machines"]:
                mid = canon(m0["id"])
                m = dict(m0, id=mid)
                hl = m.get("health") or {}
                if hl.get("state") in _HEALTH_RANK and not _expired(hl, now):  # health is whoever observes the host
                    reported.setdefault(mid, []).append((_HEALTH_RANK[hl["state"]], doc["received_at"], sid, hl))
                mine = own_machine.get(sid) == mid
                if isinstance(m0.get("lanes"), dict):   # 1.12: each source counts its own lanes here; the machine adds them all
                    lanes_by.setdefault(mid, {})[sid] = m0["lanes"]
                station = aliases[m0["id"]][1] if m0["id"] in aliases else src_of[sid]["station"] if mine else None
                if m0["id"] == mid and m0.get("label"):  # the machine's own id names it, never a row sent under an alias
                    named[mid] = m0["label"]
                cur = machines.get(mid)
                if cur is None or (mine and not cur["_mine"]) or (mine == cur["_mine"] and doc["received_at"] > cur["_at"]):
                    machines[mid] = dict(m, observed_by=sid, _mine=mine, _at=doc["received_at"])
                if station:
                    st = by_station.setdefault(mid, {}).get(_slug(station))
                    if st is None or doc["received_at"] > st["_at"]:
                        by_station[mid][_slug(station)] = dict({k: m.get(k) for k in _STATION_KEYS}, id=_slug(station), label=station,
                                                              observed_by=sid, _at=doc["received_at"])
        # When each machine was last seen through a beat: the newest beat sample any source carries for it, as a host-clock time
        # (the source's receive time less the sample's age when it built the feed; no two clocks are compared).
        beat_seen = {}
        for sid, doc in feeds.items():
            for m0 in doc["feed"]["machines"]:
                b0 = m0.get("beat") or {}
                if b0.get("age_s") is None:
                    continue
                at, mid = doc["received_at"] - b0["age_s"], canon(m0["id"])
                if mid not in beat_seen or at > beat_seen[mid][0]:
                    beat_seen[mid] = (at, b0.get("interval_s"))
        wanted = {s["machine"] for s in sources if s["machine"]} | {i["machine"] for i in items if i.get("machine")}
        for mid in wanted - set(machines):
            machines[mid] = {"id": mid, "label": mid, "status": "unknown", "synthesized": True, "observed_by": None,
                             "_mine": False, "_at": 0}
        machine_list = []
        strain = store.norms(conn)
        for mid in sorted(machines):
            m = {k: v for k, v in machines[mid].items() if not k.startswith("_")}
            m["label"] = named.get(mid) or m.get("label") or mid
            m["sources"] = [s["id"] for s in sources if s["machine"] == mid]
            m["lanes"] = machine_lanes(lanes_by.get(mid), {i["owner"] for i in items if i.get("machine") == mid},
                                       {s for s in lanes_by.get(mid, ()) if age(s) > th["lost_after_s"]})
            m["beat_seen"] = ({"at": _iso(beat_seen[mid][0]), "interval_s": beat_seen[mid][1]}
                              if mid in beat_seen else None)
            top = max(reported.get(mid, []), key=lambda r: r[:2], default=None)
            by = m.get("observed_by")
            beat_age = (m.get("beat") or {}).get("age_s")
            if top:
                m["health"] = dict(top[3], source=top[2])
            elif beat_age is not None and by in feeds and age(by) <= th["lost_after_s"] and beat_age + age(by) > th["lost_after_s"]:
                # the source is reporting but the beat it carries stopped: the host went quiet, not the reporter
                m["health"] = {"state": "lost", "since": _iso(feeds[by]["received_at"] - beat_age), "reason": None, "source": by}
            names = {_slug(s["station"]): s["station"] for s in sources if s["machine"] == mid and s["station"]}
            sts = by_station.get(mid, {})
            for key, label in names.items():
                sts.setdefault(key, {"id": key, "label": label, "status": "unknown", "observed_by": None})
            if len(sts) > 1:
                m["stations"] = []
                for key in sorted(sts):
                    st = {k: v for k, v in sts[key].items() if not k.startswith("_")}
                    st["sources"] = [s["id"] for s in sources if s["machine"] == mid and s["station"] and _slug(s["station"]) == key]
                    m["stations"].append(st)
                # worst wins: one pip for the machine, each station keeps its own ages and vitals
                m["status"] = max((st.get("status") or "unknown" for st in m["stations"]), key=lambda x: _STATUS_RANK.get(x, 1))
                prs = [st["pressure"] for st in m["stations"] if (st.get("pressure") or {}).get("level")]
                if prs:
                    worst = max(prs, key=lambda p: _PRESSURE_RANK.get(p["level"], 0))
                    m["pressure"] = dict(worst, why=[w for p in prs if p["level"] == worst["level"] for w in p.get("why") or []][:4])
            # Load against this machine's own norm, the worst of its stations (norms.py).
            vs = [norms.verdict(st, now, cfg["health"], th["lost_after_s"]) for st in strain.get(mid, [])]
            judged = [v for v in vs if v["state"] != "unknown"]
            m["strain"] = max(judged, key=lambda v: (v["state"] == "struggling", v["sustained_s"])) if judged else {"state": "unknown"}
            machine_list.append(m)

        # ---- placeholders: sources named by others but never seen -------------------------------
        named = {}
        for s in sources:
            for p in s["peers"]:
                named.setdefault(p, f"named by {s['id']}")
        for i in items:
            if i["owner"] not in known:
                named.setdefault(i["owner"], f"owns relayed work reported by {i['source']}")
        for pid, why in sorted(named.items()):
            if pid not in known and pid not in alias:   # a name that turned out to be a reporting source is not a missing one
                sources.append({"id": pid, "label": pid, "machine": None, "kind": None, "peers": [], "received_at": None,
                                "interval_s": None, "mode": None, "collectors": [], "rejected": None, "producer": None, "skew": [],
                                "pushes_24h": 0, "gaps_24h": 0, "placeholder": True, "reason": why})

        # ---- the other lists -----------------------------------------------------------------
        newest = sorted(feeds, key=lambda s: feeds[s]["received_at"], reverse=True)
        # A call one home relays about another home's task (hold:<owner>/<task>) is the same call as that home's own: the
        # owning source's copy is the one counted (relayed_copy_dropped).
        owned_calls = owned_call_keys(feeds)
        # One card per id: when several sources send the same id (a provider's quota seen from two machines), the more
        # severe copy wins, then the source that sorts first, so the card never alternates between sources as they push.
        attention, seen, pending = [], {}, []
        held = store.alerts(conn)
        for sid in sorted(feeds):
            # A machine alert is debounced (debounce.py): confirmed ones are listed as ever, one the source has left out of
            # its newest feed but not yet for two stays listed (held, `debounce: clearing`), and one said only once is
            # pending, listed apart (`pending[]`), never counted and never dropped.
            cards_now = []
            for a in feeds[sid]["feed"]["attention"]:
                if not debounce.is_machine_alert(a):
                    cards_now.append(a)
                    continue
                phase, shown = debounce.split((held.get(sid) or {}).get(str(a["id"])), a)
                if phase == "raising":
                    pending.append(dict(shown, source=sid, machine=canon(shown["machine"]) if shown.get("machine") else (src_of.get(sid) or {}).get("machine"), debounce="raising"))
                else:
                    cards_now.append(shown)
            sent = {str(a["id"]) for a in feeds[sid]["feed"]["attention"]}
            for aid, st in sorted((held.get(sid) or {}).items()):
                if aid not in sent and debounce.split(st, None)[0] == "clearing":
                    cards_now.append(dict(st["card"], debounce="clearing"))
            for a in cards_now:
                if relayed_copy_dropped(sid, a["id"], feeds, known, owned_calls):
                    continue
                card = dict(a, source=sid, machine=canon(a["machine"]) if a.get("machine") else a.get("machine"))
                at = seen.get(a["id"])
                if at is None:
                    seen[a["id"]] = len(attention)
                    attention.append(card)
                elif _SEVERITY_RANK.get(a.get("severity"), 1) > _SEVERITY_RANK.get(attention[at].get("severity"), 1):
                    attention[at] = card
        pending_by = {}
        for a in pending:
            if a["id"] in seen:
                continue
            at = pending_by.get(a["id"])
            if at is None or _SEVERITY_RANK.get(a.get("severity"), 1) > _SEVERITY_RANK.get(at.get("severity"), 1):
                pending_by[a["id"]] = a
        pending = list(pending_by.values())
        labels = cfg["labels"]
        for m in machine_list:  # a lost machine is something the viewer should know; declared rest is not an alarm
            hl = m.get("health") or {}
            if hl.get("state") == "lost":
                name = m.get("label") or m["id"]
                attention.append({
                    "id": "host:%s:lost" % m["id"], "kind": "machine", "severity": "critical",
                    "title": labels["host_lost_title"].replace("{name}", name),
                    "detail": hl.get("reason") or labels["host_lost_beat"], "since": hl.get("since"),
                    "machine": m["id"], "item": None, "group": None, "link": None,
                    "how": labels["host_lost_how"], "source": hl.get("source")})
        for a in attention:
            a["aside"] = aside(a, now)
        nxt, seen = [], set()
        for sid in newest:
            for n in feeds[sid]["feed"]["next"]:
                if n["id"] not in seen:
                    seen.add(n["id"])
                    nxt.append(dict(n, source=sid, aside="deferred" if aside(n, now) == "deferred" else None))
        nxt.sort(key=lambda n: n.get("filed") or "", reverse=True)
        done, seen = [], set()
        for sid in newest:
            for d in feeds[sid]["feed"]["done"]:
                owner = d.get("owner") or sid
                key = (owner, norm_id(owner, d["id"]))
                if key not in seen:
                    seen.add(key)
                    done.append(dict(d, source=sid, owner=owner, id=key[1]))
        done.sort(key=lambda d: d["at"], reverse=True)
        groups = {}
        for sid in newest:
            for g in feeds[sid]["feed"]["groups"]:
                cur = groups.setdefault(g["id"], {"id": g["id"], "label": g.get("label") or g["id"], "color": g.get("color"), "checkpoint": None})
                if g.get("label") and cur["label"] == g["id"]:
                    cur["label"] = g["label"]
                cur["color"] = cur["color"] or g.get("color")
                if cur["checkpoint"] is None and g.get("checkpoint"):
                    cur["checkpoint"] = dict(g["checkpoint"], source=sid)
        for i in items:  # a group named only by an item still exists
            if i.get("group"):
                groups.setdefault(i["group"], {"id": i["group"], "label": i["group"], "color": None, "checkpoint": None})
        accounts = []
        for sid in newest:
            m = feeds[sid]["feed"].get("meters") or {}
            for a in m.get("accounts") or []:
                accounts.append(dict(a, source=sid, as_of=m.get("as_of")))
        tz = _tzinfo(cfg["display"]["tz"])
        chips = allowance.chips(accounts, now, tz, ((cfg["display"].get("allowance") or {}).get("providers")), labels)
        # Each lane's kind and class (lanes.py) and its row text; a step's clock runs on for up to two intervals after a push.
        glabel = {g["id"]: g["label"] for g in groups.values()}
        # A lane a call names is waiting on the viewer whether or not its source set needs_you (feed-spec: attention.item).
        called = {(a.get("source"), a.get("item")) for a in attention if a.get("item") and a.get("severity") == "action" and not a.get("aside")}
        # A lane that waits for the viewer's OK and that no call names is an ask of its own; the calls and the lanes that disagree.
        asks, disagree = lane_asks(attention, items)
        gone_s = 60 * float(th.get("agent_gone_min", 10))
        for it in items:
            if not it.get("needs_you") and ((it["source"], it["id"]) in called or (it["owner"], it["id"]) in called):
                it["needs_you"] = True
            src = src_of.get(it["source"]) or {}
            grown = min(max(0.0, now - (src.get("received_at") or now)), 2 * (src.get("interval_s") or th["default_interval_s"]))
            it["source_lane"] = it["lane"] if isinstance(it.get("lane"), dict) else None   # 1.5: what the source says the lane is doing; `lane` below is the host's own class
            it["lane"] = lanes.classify(it, grown, now, gone_s)
            it["row"] = lanes.row(it, glabel.get(it.get("group")) if it.get("group") else None)
            it["age"] = gaps.age_in_state(it, now)   # how long in its state, and measured from what
        ask_keys = {(it["source"], it["id"]) for it in asks}
        for it in items:
            it["lane"]["asks_you"] = (it["source"], it["id"]) in ask_keys
        # ---- black holes (1.2): outside waits, shared queues, what comes up, what is not shipped ----------------------
        dsp = cfg["display"]
        qrows = [(q, sid, feeds[sid]["received_at"]) for sid in sorted(feeds) for q in feeds[sid]["feed"].get("queues") or []]
        qrows = [(dict(q, machine=canon(q["machine"]) if q.get("machine") else feeds[sid]["feed"]["source"].get("machine")), sid, at) for q, sid, at in qrows]
        holes = {
            "waits_outside": gaps.waits_outside(items, now),
            "oldest_waiting": gaps.oldest_waiting(items, now),
            "queues": gaps.queues(qrows, now, 60 * float((dsp.get("queues") or {}).get("slow_min", 30))),
            "coming_up": gaps.coming_up(nxt, items, machine_list, now, tz, int((dsp.get("coming_up") or {}).get("days", 7))),
            "deploys": gaps.deploy_gaps([(d, sid) for sid in sorted(feeds) for d in feeds[sid]["feed"].get("deploys") or []], now),
            # 1.10: the library, one row per mirrored folder; a source is silent past its late level, as the page reads it
            "mirrors": gaps.mirrors([(m, sid, src_of[sid]["machine"], feeds[sid]["feed"].get("generated_at"), feeds[sid]["received_at"],
                                      age(sid) > th["late_within_intervals"] * src_of[sid]["interval_s"])
                                     for sid in sorted(feeds) for m in feeds[sid]["feed"].get("mirrors") or []],
                                    now, (cfg.get("mirrors") or {}).get("expected"), (cfg.get("mirrors") or {}).get("retired")),
        }
        # ---- at a glance: rows grouped by project then machine, and what a screen remembers as last seen ------------
        mlabel = {m["id"]: m.get("label") or m["id"] for m in machine_list}
        projects, order = glance.projects(items, mlabel)
        for it in items:
            it["row"]["order"] = order.get((it.get("owner") or it.get("source"), it.get("id")))
            it["row"]["mark"] = glance.key("lane", it.get("owner") or it.get("source"), it.get("id"))
        omitted = [dict(o, source=sid) for sid in newest for o in feeds[sid]["feed"]["omitted"]]

        live_modes = {s["mode"] for s in sources if not s["placeholder"] and s["received_at"]}
        sample_only = bool(live_modes) and live_modes <= {"sample"}
        counts = {
            "items": len(items),
            "running": sum(1 for i in items if i.get("state") == "running"),
            "off_course": sum(1 for i in items if i["lane"]["cls"] in lanes.OFF_COURSE),
            "lanes_waiting": sum(1 for i in items if i["lane"]["cls"] == "waiting"),
            "waiting": sum(1 for i in items if i.get("state") == "waiting"),
            "awaiting_you": sum(1 for i in items if (i.get("handoff") or {}).get("state") == "awaiting_you"),
            "unknown": sum(1 for i in items if i.get("state") in (None, "unknown")),
            "attention": sum(1 for a in attention if a.get("severity") != "info"),
            # machine alerts said once and not yet confirmed (debounce.py): never in the numbers above, never dropped
            "attention_pending": len(pending),
            # the board's WAIT ON YOU number (waiting_on_you: one per ask, never a problem or an FYI); `calls` is the same count
            # of the call cards alone, and the reporting sources whose share of it is unverified
            "waiting_on_you": len(waiting_on_you(attention, items)),
            "calls": sum(1 for a in attention if is_call(a)),
            "waiting_unverified": [s["id"] for s in sources if (s.get("waiting") or {}).get("verified") is False],
            "next": len(nxt),
            "agent_gone": sum(1 for i in items if i["lane"]["kind"] == "agent_gone"),
            "outside": len(holes["waits_outside"]),
            "queued": sum(q["length"] or 0 for q in holes["queues"]),
            # sources whose adapter is older than a change that matters while a peer already runs it, and those that said no version
            "version_skew": [s["id"] for s in sources if s["skew"]],
            "version_unknown": [s["id"] for s in sources if not s["placeholder"] and not (s["producer"] or {}).get("version")],
        }
        view = {
            "sources": sources, "machines": machine_list, "items": items, "attention": attention, "attention_pending": pending, "next": nxt,
            "done": done[:30], "goals": goals.headers([feeds[sid]["feed"].get("goals") or [] for sid in newest], items, nxt, done[:30], len(done) > 30),
            "groups": list(groups.values()), "meters": {"accounts": accounts, "chips": chips}, "omitted": omitted,
            "counts": counts, "waiting_disagree": disagree, "sample": "sample" in live_modes, "sample_only": sample_only, "gaps": holes,
            "history": history_view(conn, now, 1 if sample_only else 0),
        }
        # Landing times of the last week (a screen away for days still counts what landed since), newest first, bounded.
        landed_at = [r["at"] for r in conn.execute("SELECT at FROM done WHERE at >= ? AND at <= ? AND sample = ? ORDER BY at DESC LIMIT 2000",
                                                   (now - 7 * 86400, now + 60, 1 if sample_only else 0))]
        view["glance"] = {"marks": glance.marks(items, attention, landed_at), "projects": projects}
        view["fleet"] = fleet.view(sources, machine_list, dsp)
        view["cards"], view["cards_rejected"] = cards.view(now)
        if redaction != "none":
            redact(view, redaction, cfg["labels"])
        return view
    finally:
        conn.close()
