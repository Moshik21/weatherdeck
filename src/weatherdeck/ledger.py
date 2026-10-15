"""The tool value ledger: read one tool's append-only file and say, per counter, the value or why it is unknown, and the
reading of the tool's window (docs/ledger-spec.md): KEEP, QUIET, CUT-CANDIDATE or UNMEASURED.

Pure apart from `read`, which opens the one path it is given and nothing else: no clock (the end of the window is passed
in), no other file, no write. A bad file never raises: a line that does not parse or validate is skipped and listed. Unknown
stays unknown: a counter with no usable number has `value` None and a reason, and a missing day counts as no coverage,
never as zero. The thresholds are documented defaults (`RULE`); a caller may override any of them.
"""
import json
import math
import re

VERSION = 1
DAY = 86400
UNKNOWN = ("no-state-dir", "field-absent", "source-truncated", "source-unreadable", "not-measurable")
QUALITY = ("exact", "lower-bound", "rebuilt", "estimate", "labelled-offline")
KINDS = ("jsonl", "log", "table", "api")
COUNTER_RE = re.compile(r"^[a-z0-9_]+$")
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
RETIRED = frozenset(("caught", "saved", "prevented", "avoided", "averted", "spared", "rescued"))

# The reading rule's numbers, as documented defaults (docs/ledger-spec.md, "Reading rule"). Proposals, not measurements.
RULE = {
    "window_days": 14,             # a reading period; also the shortest window a number may be cited from
    "covered_min": 0.9,            # coverage at or above this is covered
    "partial_min": 0.5,            # at or above this and under covered_min is partial; under it, blind
    "quiet_windows_for_cut": 2,    # consecutive QUIET windows that make a cut candidate
    "judged_wrong_share_max": 0.30,
    "override_share_max": 0.50,
    "min_hosts_to_cite": 2,        # hosts that contributed, where the file names this many or more
    "cost": {},                    # tool -> {"counter": name, "budget": number}; none declared, so no cost clause runs
}

# Per tool: the counters whose sum is its value event, the verb each is said in, and the shares that make a cut candidate.
# Three tools were renamed (harbor is lodgings, doctor is infirmary, preflight is seaworthy). Both names are accepted and read
# the same profile: a line is matched on the `tool` it carries, so an old-name file and a new-name file each read as written.
RENAMED = {"harbor": "lodgings", "doctor": "infirmary", "preflight": "seaworthy"}
PROFILES = {
    "weatherdeck": {"events": {"surfaced_cleared": "surfaced"}, "shares": []},
    "doctor": {
        "events": {"repairs_verified": "repaired and verified", "judged_real": "judged real"},
        "shares": [{"name": "judged_wrong_share", "num": "judged_wrong", "den": ("judged_real", "judged_wrong"), "max": "judged_wrong_share_max"}],
    },
    "harbor": {"events": {"gate_refused": "refused", "passport_confirmed": "moved", "drains_completed": "drained in place"}, "shares": []},
    "preflight": {
        "events": {"refusals_stood": "refused"},
        "shares": [{"name": "override_share", "num": "overrides", "den": ("gate_refused",), "max": "override_share_max"}],
    },
}
PROFILES.update({new: PROFILES[old] for old, new in RENAMED.items()})


def _int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def retired(name):
    """True when a counter name has a retired word as one of its `_`-separated parts."""
    return bool(RETIRED & set(name.split("_")))


def check(rec):
    """None when one parsed line is a valid v1 reading, else the short reason it is not."""
    if not isinstance(rec, dict):
        return "not-an-object"
    if rec.get("v") != VERSION:
        return "unknown-version"
    for k in ("id", "tool", "counter", "host", "reader"):
        if not isinstance(rec.get(k), str) or not rec[k].strip():
            return "bad-" + k
    if not COUNTER_RE.match(rec["counter"]):
        return "bad-counter"
    if len(rec["host"]) > 64:
        return "bad-host"
    w = rec.get("window")
    if not isinstance(w, dict) or not _int(w.get("from")) or not _int(w.get("to")) or w["from"] >= w["to"]:
        return "bad-window"
    if not _int(rec.get("read_at")):
        return "bad-read_at"
    sup = rec.get("supersedes")
    if sup is not None and (not isinstance(sup, str) or not sup or sup == rec["id"]):
        return "bad-supersedes"
    if rec.get("quality") not in QUALITY:
        return "bad-quality"
    if rec.get("combine", "sum") not in ("sum", "max"):
        return "bad-combine"
    cov = rec.get("coverage")
    if not isinstance(cov, dict) or not _int(cov.get("rows")) or cov["rows"] < 0:
        return "bad-coverage"
    if not _num(cov.get("covers_window")) or not 0 <= cov["covers_window"] <= 1:
        return "bad-coverage"
    for k in ("first_at", "last_at"):
        if cov.get(k) is not None and not _int(cov[k]):
            return "bad-coverage"
    value, why = rec.get("value"), rec.get("unknown")
    if value is None:
        if why not in UNKNOWN:
            return "unknown-without-reason"
        return None
    if why is not None:
        return "value-with-unknown"
    if retired(rec["counter"]):
        return "retired-word-in-counter"
    if not _num(value) or value < 0:
        return "bad-value"
    if value == 0 and cov["covers_window"] != 1.0:
        return "zero-without-coverage"          # a lower bound of 0 is an unknown, never a zero
    src = rec.get("src")
    if not isinstance(src, dict) or src.get("kind") not in KINDS:
        return "number-without-src"
    f = src.get("file")
    if not isinstance(f, str) or not f.strip() or "/" in f or "\\" in f:
        return "bad-src-file"
    if not isinstance(src.get("digest"), str) or not DIGEST_RE.match(src["digest"]):
        return "number-without-digest"
    refs = (src.get("first_ref"), src.get("last_ref"))
    if (refs[0] is None) != (refs[1] is None) or any(r is not None and (not isinstance(r, str) or not r) for r in refs):
        return "bad-src-refs"
    ex = rec.get("excluded")
    if not isinstance(ex, dict) or any(not _int(n) or n < 0 for n in ex.values()):
        return "number-without-excluded"
    return None


def parse(text, tool=None):
    """The lines of one ledger file: {tool, active[], skipped[{line, reason}], dangling[ids], lines}.
    `active` keeps valid lines that nothing supersedes, as {n, **line}. Every other line is in `skipped` or superseded."""
    skipped, valid, seen = [], [], set()
    want = tool
    n = 0
    for n, raw in enumerate(text.split("\n"), 1):
        raw = raw.strip()
        if not raw:
            continue
        try:
            rec = json.loads(raw)
        except ValueError:
            skipped.append({"line": n, "reason": "not-json"})
            continue
        bad = check(rec)
        if bad:
            skipped.append({"line": n, "reason": bad})
            continue
        want = want or rec["tool"]
        if rec["tool"] != want:
            skipped.append({"line": n, "reason": "wrong-tool"})
        elif rec["id"] in seen:
            skipped.append({"line": n, "reason": "duplicate-id"})
        else:
            seen.add(rec["id"])
            valid.append(dict(rec, n=n))
    voided, dangling, before = set(), [], set()
    for rec in valid:
        sup = rec.get("supersedes")
        if sup:
            (voided.add(sup) if sup in before else dangling.append(sup))
        before.add(rec["id"])
    return {"tool": want, "active": [r for r in valid if r["id"] not in voided], "skipped": skipped,
            "dangling": dangling, "superseded": len(voided), "lines": n}


def _status(cov, value, rule):
    if value is None or cov < rule["partial_min"]:
        return "blind"
    return "covered" if cov >= rule["covered_min"] else "partial"


def counter(active, name, lo, hi, hosts, rule=RULE, absent="no-reading"):
    """One counter over the window [lo, hi): {value, unknown, reasons, quality, coverage, status, hosts, lines, outside}.
    `hosts` are the machines the window is spread over; a host with no line adds nothing to the coverage."""
    # A hand label is never a runtime number: it takes no part in any sum, coverage or conflict.
    mine = [r for r in active if r["counter"] == name and r["quality"] != "labelled-offline"]
    inside = [r for r in mine if r["window"]["from"] >= lo and r["window"]["to"] <= hi]
    outside = sum(1 for r in mine if r["window"]["from"] < hi and r["window"]["to"] > lo) - len(inside)
    combos = {r.get("combine", "sum") for r in inside if r["value"] is not None}
    reasons, weight, nums, contributors = set(), 0.0, [], set()
    conflict = len(combos) > 1
    for host in sorted({r["host"] for r in inside}):
        rows = sorted((r for r in inside if r["host"] == host), key=lambda r: r["window"]["from"])
        if conflict or any(a["window"]["to"] > b["window"]["from"] for a, b in zip(rows, rows[1:])):
            conflict = True
            continue
        for r in rows:
            if r["value"] is None:
                reasons.add(r["unknown"])
                continue
            nums.append(r)
            contributors.add(host)
            weight += r["coverage"]["covers_window"] * (r["window"]["to"] - r["window"]["from"])
    span = (hi - lo) * len(hosts)
    cov = min(1.0, weight / span) if span > 0 and not conflict else 0.0
    if conflict:
        nums, contributors, reasons = [], set(), {"conflict"}
    if nums:
        vals = [r["value"] for r in nums]
        value = max(vals) if "max" in combos else sum(vals)
        quality = ("lower-bound" if cov < 1 or any(r["quality"] == "lower-bound" for r in nums) else
                   "estimate" if any(r["quality"] == "estimate" for r in nums) else
                   "rebuilt" if any(r["quality"] == "rebuilt" for r in nums) else "exact")
        reasons = set()
    else:
        value, quality = None, None
        reasons = reasons or {absent}
    return {"value": value, "unknown": (None if value is not None else (sorted(reasons)[0] if len(reasons) == 1 else "mixed")),
            "reasons": sorted(reasons) if value is None else [], "quality": quality, "coverage": math.floor(round(cov * 10000, 6)) / 10000,
            "status": _status(cov, value, rule), "hosts": sorted(contributors), "lines": len(inside), "outside": outside}


def _window(parsed, lo, hi, expected, rule, names, absent):
    hosts = sorted({r["host"] for r in parsed["active"] if r["window"]["from"] >= lo and r["window"]["to"] <= hi
                    and r["quality"] != "labelled-offline"} | set(expected))
    have = {r["counter"] for r in parsed["active"]}
    out = {n: counter(parsed["active"], n, lo, hi, hosts, rule, absent) for n in sorted(set(names) | have)}
    return hosts, out


def judge(tool, counters, rule=RULE):
    """The reading of one window from its counters: {base, why[], events{}, lower_bound, cut[]}.
    base is KEEP, QUIET, CUT-CANDIDATE or UNMEASURED before the two-windows rule is applied."""
    prof = PROFILES.get(tool)
    if prof is None:
        return {"base": "UNMEASURED", "why": ["no-rule-for-tool"], "events": {}, "lower_bound": False, "cut": []}
    got = lambda n: counters.get(n) or {"value": None, "status": "blind"}
    covered = lambda n: got(n)["status"] == "covered"
    events = {n: got(n)["value"] for n in prof["events"] if got(n)["status"] in ("covered", "partial") and got(n)["value"]}
    lower = any(got(n)["status"] == "partial" for n in events)
    cut = []
    for s in prof["shares"]:
        if covered(s["num"]) and all(covered(d) for d in s["den"]):
            den = sum(got(d)["value"] for d in s["den"])
            if den > 0 and got(s["num"])["value"] / den > rule[s["max"]]:
                cut.append("%s above %g" % (s["name"], rule[s["max"]]))
    budget = (rule.get("cost") or {}).get(tool)
    if budget and not events and covered(budget["counter"]) and got(budget["counter"])["value"] > budget["budget"]:
        cut.append("cost over budget with no value event")
    if cut:
        return {"base": "CUT-CANDIDATE", "why": cut, "events": events, "lower_bound": lower, "cut": cut}
    if events:
        return {"base": "KEEP", "why": ["value events: " + ", ".join(sorted(events))], "events": events, "lower_bound": lower, "cut": []}
    if all(covered(n) for n in prof["events"]):
        return {"base": "QUIET", "why": ["no value event in a covered window"], "events": {}, "lower_bound": False, "cut": []}
    gaps = ["%s %s" % (n, got(n)["status"]) for n in prof["events"] if not covered(n)]
    return {"base": "UNMEASURED", "why": gaps, "events": {}, "lower_bound": False, "cut": []}


def cannot_cite(tool, reading, judged, counters, hosts, days, rule=RULE):
    """Why a number about this tool may not be cited outside yet (empty: it may). Only what a record can show."""
    out = []
    if reading != "KEEP":
        out.append("reading is " + reading)
    prof = PROFILES.get(tool) or {"events": {}}
    used = sorted(judged["events"])
    for n in used:
        c = counters[n]
        if c["status"] != "covered":
            out.append("%s is %s" % (n, c["status"]))
        elif c["quality"] != "exact":
            out.append("%s is %s" % (n, c["quality"]))
    if days < rule["window_days"]:
        out.append("window is under %d days" % rule["window_days"])
    if len(hosts) >= rule["min_hosts_to_cite"] and len({h for n in used for h in counters[n]["hosts"]}) < rule["min_hosts_to_cite"]:
        out.append("fewer than %d hosts contributed" % rule["min_hosts_to_cite"])
    if not prof["events"]:
        out.append("no rule for this tool")
    return out


def assess(parsed, to, days=None, expected_hosts=(), rules=None, absent="no-reading"):
    """Read a parsed file over the `days` days ending at `to` (epoch seconds, the end of the last closed day)."""
    rule = dict(RULE, **(rules or {}))
    days = days or rule["window_days"]
    span = days * DAY
    tool = parsed["tool"]
    names = list((PROFILES.get(tool) or {"events": {}})["events"])
    for s in (PROFILES.get(tool) or {"shares": []})["shares"]:
        names += [s["num"], *s["den"]]
    cost = (rule.get("cost") or {}).get(tool)
    if cost:
        names.append(cost["counter"])
    hosts, counters = _window(parsed, to - span, to, expected_hosts, rule, names, absent)
    j = judge(tool, counters, rule)
    need = max(1, int(rule["quiet_windows_for_cut"]))
    earlier = []
    for k in range(1, max(need, 2)):
        _, before = _window(parsed, to - (k + 1) * span, to - k * span, expected_hosts, rule, names, absent)
        earlier.append(judge(tool, before, rule))
    prev = earlier[0]
    reading, why = j["base"], list(j["why"])
    if reading == "QUIET" and all(e["base"] == "QUIET" for e in earlier[:need - 1]):
        reading, why = "CUT-CANDIDATE", ["no value event in %d covered windows in a row" % need]
    verbs = {n: (PROFILES[tool]["events"][n]) for n in j["events"]} if tool in PROFILES else {}
    return {
        "tool": tool, "window": {"from": to - span, "to": to, "days": days}, "hosts": hosts, "counters": counters,
        "verdict": {"reading": reading, "why": why, "events": j["events"], "verbs": verbs, "lower_bound": j["lower_bound"],
                    "previous": prev["base"], "cannot_cite": cannot_cite(tool, reading, j, counters, hosts, days, rule)},
        "file": {"lines": parsed["lines"], "used": len(parsed["active"]), "skipped": parsed["skipped"],
                 "superseded": parsed["superseded"], "dangling": parsed["dangling"]},
    }


def read(path, to, days=None, expected_hosts=(), tool=None, rules=None):
    """Read the ledger file at `path` and return the counters and the reading for the window ending at `to`.
    A file that is missing or cannot be read is every counter unknown and the reading UNMEASURED, never an error."""
    state, text = "ok", ""
    try:
        with open(path, "rb") as f:
            text = f.read().decode("utf-8", "replace")
    except FileNotFoundError:
        state = "missing"
    except OSError:
        state = "unreadable"
    parsed = parse(text, tool)
    parsed["tool"] = parsed["tool"] or tool
    out = assess(parsed, to, days, expected_hosts, rules, {"ok": "no-reading", "missing": "no-ledger", "unreadable": "ledger-unreadable"}[state])
    out["file"]["state"] = state
    return out
