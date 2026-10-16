"""Validation of one lookout.feed document (see docs/feed-spec.md).

Only the envelope is required (schema, schema_version, source.id). Everything else is
optional, so a minimal adapter can send a handful of items. A field that is present must have
the right type; unknown fields and unknown enum values pass through (the page renders them
generically). Raises Reject with a short reason; never raises anything else for bad input.
"""
import calendar
import re
import time

SCHEMA = "lookout.feed"
MAJOR = 1

MAX_STR = 2000
MAX_DEPTH = 12
CAPS = {"items": 60, "attention": 30, "machines": 12, "next": 30, "done": 30, "events": 200,
        "groups": 16, "collectors": 20, "omitted": 50, "queues": 16, "deploys": 8, "goals": 20, "mirrors": 8}

ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,47}$")
TIME_RE = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$")
DATE_RE = re.compile(r"^\d{4}-\d\d-\d\d$")
URL_RE = re.compile(r"^https?://[^\s<>\"']{1,500}$")


class Reject(Exception):
    def __init__(self, reason, kind="invalid"):
        super().__init__(reason)
        self.reason = reason
        self.kind = kind


def parse_time(s):
    """RFC 3339 UTC string ending in Z -> epoch seconds (float)."""
    whole, _, frac = s[:-1].partition(".")
    return calendar.timegm(time.strptime(whole, "%Y-%m-%dT%H:%M:%S")) + (float("0." + frac) if frac else 0.0)


# ---- field specs -------------------------------------------------------------------------
# "str" "int" "num" "bool" "time" "date" "when" (a time or a date) "url" "strs" "any"; a trailing "?" allows null.
# {...} is a nested object spec, ("list", {...}, cap) a list of objects.
SOURCE = {"id": "str", "label": "str?", "machine": "str?", "station": "str?", "kind": "str?", "peers": "strs?", "retired": "bool?"}
# 1.3: the software behind the feed. `version` is the adapter's, `pusher` the program that carries it to the host, `host` the
# computer's own short name, `meaning[]` what an older version of this adapter cannot do (docs/feed-spec.md, "Versions").
PRODUCER = {"name": "str?", "version": "str?", "boot_id": "str?", "seq": "int?", "mode": "str?",
            "host": "str?", "pusher": {"name": "str?", "version": "str?"},
            "meaning": ("list", {"since": "str?", "effect": "str?"}, 12)}
COLLECTOR = {"id": "str", "as_of": "time?", "status": "str?", "error": "str?", "warnings": "int?",
             "label": "str?", "stale_after_s": "int?",   # 1.2: a name for the board and how old it may get
             # 1.12: when the copy it read was made by its maker (never the file's modification time), and how often that maker remakes it
             "made_at": "time?", "refresh_s": "int?"}
MACHINE = {
    "id": "str", "label": "str?", "role": "str?", "status": "str?", "as_of": "time?",
    "reach": {"probe_ok": "bool?", "rtt_ms": "num?", "last_ok_at": "time?", "error": "str?"},
    "load": {"l1": "num?", "l5": "num?", "cores": "int?", "runq_per_core": "num?", "runq_now": "num?", "runq_basis": "str?",
             "psi_some10": "num?", "busy_pct": "num?"},
    "mem": {"used_pct": "num?", "swap_used_pct": "num?", "avail_gb": "num?", "total_gb": "num?", "swap_rate_pps": "num?",
            "swap_rate_pps_1m": "num?", "paging_pps": "num?", "commit_pct": "num?", "compressor_gb": "num?",
            "psi_some10": "num?", "psi_full10": "num?", "native_pressure": "str?"},
    "io": {"busy_pct": "num?", "psi_some10": "num?"},
    "pressure": {"level": "str?", "why": "strs?"},
    "beat": {"seq": "int?", "interval_s": "int?", "age_s": "num?", "version": "str?", "errors": "strs?",
             "cost": {"cpu_pct": "num?", "cpu_pct_total": "num?", "cpu_s_per_h": "num?", "rss_mb": "num?", "collect_ms": "num?",
                      "uptime_s": "num?", "budget_cpu_pct": "num?", "over_budget": "bool?"}},
    "health": {"state": "str?", "since": "time?", "reason": "str?", "until": "when?"},
    "disks": ("list", {"label": "str?", "free_gb": "num?", "free_pct": "num?", "warn_gb": "num?", "crit_gb": "num?"}, 8),
    "uptime_s": "num?", "on_battery": "bool?",
    "extras": ("list", {"label": "str?", "value": "any?", "severity": "str?"}, 12),
    # 1.12: the lanes this source runs on this machine (its own only); the host adds every source's for the machine
    "lanes": {"running": "int?", "total": "int?"},
}
STEP = {"id": "str", "label": "str?", "status": "str?", "weight": "num?", "elapsed_s": "num?",
        "typical_s": "num?", "p90_s": "num?", "round": "int?"}
PROGRESS = {
    "basis": "str?", "history_n": "int?", "percent_floor": "num?", "percent_ceiling": "num?",
    "regressed": "bool?", "reason": "str?",
    "current": {"step": "str?", "elapsed_s": "num?", "typical_s": "num?", "p90_s": "num?", "round": "int?",
                "activity": "str?", "last_activity_age_s": "num?", "waiting_since": "time?"},
    "steps": ("list", STEP, 30),
}
# 1.5: a lane's state word, why, since when and its last word; and the sentence as parts the board words itself
LANE = {"state": "str?", "cause": "str?", "since": "time?", "last_word": {"verb": "str?", "at": "time?"}, "short_title": "str?",
        "branch": "bool?"}   # 1.12: the work is on a pushed branch with no pull request (false: the source looked and found none)
SAY = {"t": "str", "step": "int?", "of": "int?", "at": "time?", "until": "when?", "how": "str?", "gate": "str?", "decides": "str?",
       "findings": "int?", "n": "int?", "more": "int?", "title": "str?", "verb": "str?"}
LINK = {"url": "url?", "label": "str?", "state": "str?", "state_as_of": "time?"}
# 1.6: where a call that waits on the viewer can be answered (the source's review board), when it was last checked, or why there is no link
ANSWER_LINK = {"url": "url?", "label": "str?", "state": "str?", "state_as_of": "time?", "why": "str?"}
# 1.12: whose turn a card is, a hold the viewer put on it until a date, and a verdict it waits on (docs/feed-spec.md, "Whose turn")
ACTOR = {"role": "str?", "name": "str?"}
HOLD = {"bucket": "str?", "until": "when?", "reason": "str?", "since": "time?"}
VERDICT = {"name": "str?", "state": "str?", "as_of": "time?"}
ITEM = {
    "id": "str", "owner": "str?", "relayed": "bool?", "group": "str?", "machine": "str?", "kind": "str?",
    "title": "str?", "doing": "str?", "state": "str?", "state_detail": "str?", "started_at": "time?",
    "last_event": {"state": "str?", "text": "str?", "at": "time?"},
    "progress": PROGRESS,
    "handoff": {"state": "str?", "since": "time?"},
    "link": LINK, "flags": "strs?", "needs_you": "bool?",
    "reported": {"label": "str?", "percent": "num?", "basis": "str?", "at": "time?"},
    # 1.1: honest row text and the waiting taxonomy (docs/feed-spec.md); all optional
    "project": "str?", "summary": "str?", "waiting_on": "str?", "until": "when?",
    # 1.2: who or what an outside wait is on, since when, since when the item is in its state, and its agent's session
    "waiting_for": "str?", "waiting_since": "time?", "state_since": "time?",
    "agent": {"state": "str?", "since": "time?", "as_of": "time?", "reason": "str?"},
    # 1.5: one of nine fixed words for what the lane is doing, and one sentence as template parts (docs/feed-spec.md, "Lane state")
    "lane": LANE, "say": ("list", SAY, 8),
    # 1.7: the goal the work serves, the owner's own words (docs/feed-spec.md, "Goals"); absent when no goal is set for it
    "goal": "str?",
}
ATTENTION = {"id": "str", "kind": "str?", "severity": "str?", "title": "str?", "detail": "str?", "since": "time?",
             "machine": "str?", "item": "str?", "group": "str?", "link": LINK, "answer_link": ANSWER_LINK, "how": "str?", "recommend": "str?", "say": "str?",
             # 1.8: when the answer behind this call was made (the source's own copy time); absent when the source does not know
             "as_of": "time?",
             # 1.9: the choices a call offers, plain words from the source's structured record (at most 4, each at most 60 characters)
             "options": ("list", "str", 4),
             # 1.12: whose turn it is, a dated hold, and a verdict it waits on
             "actor": ACTOR, "hold": HOLD, "verdict": VERDICT}
NEXT = {"id": "str", "group": "str?", "title": "str?", "kind": "str?", "blocked_by": "strs?", "reason": "str?",
        "until": "date?", "filed": "date?", "goal": "str?", "hold": HOLD}   # hold: 1.12
DONE = {"id": "str", "owner": "str?", "group": "str?", "title": "str?", "via": "str?", "link": LINK, "at": "time", "goal": "str?"}
# 1.7: one header per goal that has rows: how many lanes, queued rows and landed rows the feed carries for it, and which of those
# counts may be low because rows were left out (`or_more`: any of "lanes", "next", "done")
GOAL = {"name": "str", "lanes": "int?", "next": "int?", "done": "int?", "or_more": "strs?"}
EVENT = {"at": "num", "item": "str?", "kind": "str?", "text": "str?"}
GROUP = {
    "id": "str", "label": "str?", "color": "str?",
    "checkpoint": {
        "as_of": "time?",
        "live": {"version": "str?", "since": "str?"},
        "next": {"version": "str?", "waiting_on": "strs?", "items_ready": "int?"},
        "gate": {"value": "str?", "as_of": "time?", "note": "str?", "sha": "str?",
                 "tiers": ("list", {"id": "str", "verdict": "str?"}, 8), "failing": "strs?", "ship": "str?"},
    },
}
METERS = {
    "as_of": "time?",
    "accounts": ("list", {
        "id": "str", "label": "str?", "machine": "str?",
        "provider": "str?", "account": "str?",
        "windows": ("list", {"id": "str?", "label": "str?", "short": "str?", "percent_remaining": "num?", "resets_at": "time?",
                             "pace": "str?"}, 8),
        "runway": {"status": "str?", "confidence": "str?", "projected_empty_at": "time?", "source": "str?"},
    }, 8),
}
# 1.2: a shared resource that work waits its turn for (a build slot, a test floor, a device)
QUEUE = {"id": "str", "label": "str?", "machine": "str?", "length": "int?", "oldest_wait_s": "num?", "held": "int?", "cap": "int?",
         "holders": ("list", {"label": "str?", "since": "time?"}, 12), "as_of": "time?"}
# 1.2: how far what is deployed is behind what is merged
DEPLOY = {"id": "str", "label": "str?", "group": "str?", "deployed": {"version": "str?", "at": "time?"},
          "head": {"version": "str?", "at": "time?"}, "behind": "int?", "oldest_unshipped_at": "time?", "as_of": "time?",
          "error": "str?"}
# 1.10: one folder a source mirrors into a shared repository, copied from the receipt its sync job writes on every run: when the job
# last ran (`checked_at`), how that run ended, origin's newest change to the folder, what is written but not yet in the repository
# (`pending`), and how old the receipt may get (docs/feed-spec.md, "Library")
MIRROR = {"id": "str", "label": "str?", "repo": "str?", "ns": "str?", "as_of": "time?", "interval_s": "int?", "stale_after_s": "int?",
          "checked_at": "time?", "finished_at": "time?", "outcome": "str?", "detail": "str?", "failing_since": "time?",
          "files": "int?", "changed": "int?", "skipped": "int?", "head": "str?", "origin_head": "str?", "verified_at": "time?",
          "changed_at": "time?", "changed_sha": "str?", "pending": {"files": "int?", "since": "time?"}, "retired": "bool?"}
# 1.4: how far a source has stretched its own intervals, and why, and what it has cost against its own budgets
PACE = {"factor": "num?", "why": "strs?", "since": "time?", "pass_s": "int?", "normal_pass_s": "int?", "keepalive_s": "int?",
        "normal_keepalive_s": "int?", "load_per_core": "num?", "on_battery": "bool?",
        "cost": {"cpu_s_per_h": "num?", "budget_cpu_s_per_h": "num?", "run_s": "num?", "budget_run_s": "num?",
                 "over_budget": "bool?", "measured_s": "num?"}}
OMITTED = {"surface": "str?", "shown": "int?", "total": "int?", "reason": "str?"}
WAITING = {"basis": "str?", "verified": "bool?", "as_of": "time?", "age_s": "num?", "reason": "str?", "note": "str?"}   # note: 1.11
TOP = {
    "schema": "str", "schema_version": "str", "source": SOURCE, "producer": PRODUCER,
    "generated_at": "time?", "interval_s": "int?", "collect_ms": "int?",
    "collectors": ("list", COLLECTOR, CAPS["collectors"]),
    "machines": ("list", MACHINE, CAPS["machines"]),
    "items": ("list", ITEM, CAPS["items"]),
    "attention": ("list", ATTENTION, CAPS["attention"]),
    "next": ("list", NEXT, CAPS["next"]),
    "done": ("list", DONE, CAPS["done"]),
    "events": ("list", EVENT, CAPS["events"]),
    "groups": ("list", GROUP, CAPS["groups"]),
    "meters": METERS,
    "counts": "any?",
    "waiting": WAITING,
    "omitted": ("list", OMITTED, CAPS["omitted"]),
    "queues": ("list", QUEUE, CAPS["queues"]),
    "deploys": ("list", DEPLOY, CAPS["deploys"]),
    "pace": PACE,
    "goals": ("list", GOAL, CAPS["goals"]),
    "mirrors": ("list", MIRROR, CAPS["mirrors"]),
}
LIST_KEYS = tuple(k for k, v in TOP.items() if isinstance(v, tuple))


def _scalar(path, val, code, warn):
    nullable = code.endswith("?")
    base = code.rstrip("?")
    if val is None:
        if nullable:
            return val
        raise Reject(f"{path}: required")
    ok = True
    if base == "str":
        ok = isinstance(val, str)
        if ok and len(val) > MAX_STR:
            raise Reject(f"{path}: string longer than {MAX_STR} characters")
    elif base == "int":
        ok = isinstance(val, int) and not isinstance(val, bool)
    elif base == "num":
        ok = isinstance(val, (int, float)) and not isinstance(val, bool) and val == val and abs(val) < 1e15
    elif base == "bool":
        ok = isinstance(val, bool)
    elif base == "time":
        ok = isinstance(val, str) and bool(TIME_RE.match(val))
        if ok:
            try:
                parse_time(val)
            except ValueError:
                ok = False
    elif base == "date":
        ok = isinstance(val, str) and bool(DATE_RE.match(val))
    elif base == "when":
        ok = isinstance(val, str) and bool(DATE_RE.match(val) or TIME_RE.match(val))
        if ok and TIME_RE.match(val):
            try:
                parse_time(val)
            except ValueError:
                ok = False
    elif base == "url":
        if isinstance(val, str) and URL_RE.match(val):
            return val
        warn.append(f"{path}: dropped a non-http(s) link")
        return None
    elif base == "strs":
        ok = isinstance(val, list) and len(val) <= 50 and all(isinstance(x, str) and len(x) <= 200 for x in val)
    elif base == "any":
        ok = isinstance(val, (str, int, float, bool)) and (not isinstance(val, str) or len(val) <= MAX_STR)
    if not ok:
        raise Reject(f"{path}: expected {base}")
    return val


def _check(path, val, spec, warn, depth=0):
    if depth > MAX_DEPTH:
        raise Reject(f"{path}: nested too deeply")
    if isinstance(spec, str):
        return _scalar(path, val, spec, warn)
    if isinstance(spec, tuple):
        _, item_spec, cap = spec
        if val is None:
            return []
        if not isinstance(val, list):
            raise Reject(f"{path}: expected a list")
        if len(val) > cap:
            raise Reject(f"{path}: {len(val)} entries, the limit is {cap}")
        return [_check(f"{path}[{i}]", v, item_spec, warn, depth + 1) for i, v in enumerate(val)]
    if val is None:
        return None
    if not isinstance(val, dict):
        raise Reject(f"{path}: expected an object")
    out = dict(val)  # unknown fields pass through
    for key, sub in spec.items():
        if key in val:
            out[key] = _check(f"{path}.{key}" if path else key, val[key], sub, warn, depth + 1)
        elif isinstance(sub, str) and not sub.endswith("?"):
            raise Reject(f"{path + '.' if path else ''}{key}: required")
        elif isinstance(sub, tuple):
            out[key] = []
    return out


def validate(doc):
    """Return (clean document, warnings). Raises Reject."""
    if not isinstance(doc, dict):
        raise Reject("the document must be a JSON object")
    if doc.get("schema") != SCHEMA:
        raise Reject(f"schema must be {SCHEMA!r}", "schema")
    ver = doc.get("schema_version")
    m = re.match(r"^(\d{1,4})\.(\d{1,4})$", ver) if isinstance(ver, str) else None
    if not m:
        raise Reject("schema_version must look like MAJOR.MINOR", "schema")
    if int(m.group(1)) != MAJOR:
        raise Reject(f"feed is version {ver}, this dashboard reads {MAJOR}.x: update the dashboard", "version")
    warn = []
    clean = _check("", doc, TOP, warn)
    src = clean.get("source")
    if not isinstance(src, dict) or not isinstance(src.get("id"), str):
        raise Reject("source.id: required")
    if not ID_RE.match(src["id"]):
        raise Reject("source.id: use 1-48 characters from a-z 0-9 . _ - starting with a letter or digit")
    if clean.get("producer") is None:
        clean["producer"] = {}
    prod = clean["producer"]
    if prod.get("mode") not in (None, "live", "sample"):
        raise Reject("producer.mode: must be live or sample")
    prod.setdefault("mode", "live")
    if prod.get("seq") is not None and prod["seq"] < 0:
        raise Reject("producer.seq: must not be negative")
    for key in LIST_KEYS:
        clean.setdefault(key, [])
    clean.setdefault("meters", None)
    return clean, warn
