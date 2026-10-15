"""Ledger cards: one status card per tool, built from what its value ledger says (docs/ledger-spec.md, docs/ADDINS.md).

Off unless asked (`ledger.enabled`). It starts no process and opens no socket: per tool it stats one file and, only when
that file changed (or the day did), reads it once through `ledger.read`. The card says the reading (keep, quiet,
cut candidate, unmeasured), the window, and per counter the value or why it is unknown, in the record's own verbs. A ledger
that is missing or cannot be read is "no ledger yet", never zero. A number that is not covered is said as "at least" or
withheld as unknown, never rounded up. The words "caught" and "saved" are retired and appear nowhere here.
"""
import logging
import math
import os
import re
import stat
import time

from . import config, ledger

log = logging.getLogger("weatherdeck.ledgercards")

DAY = ledger.DAY
TOOL_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")
HOST_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
MAX_TOOLS = 8
MAX_NUMBERS = 6
HEADLINE = 160

# reading -> (card status, card mode, plain words). A cut candidate is a review a person decides, so it is warn, never bad;
# unmeasured is unknown. Quiet is ok: nothing to do, and a guard that never fires may be healthy.
READING = {
    "KEEP": ("ok", "keep", "Keep"),
    "QUIET": ("ok", "quiet", "Quiet"),
    "CUT-CANDIDATE": ("warn", "cut-candidate", "Cut candidate"),
    "UNMEASURED": ("unknown", "unmeasured", "Unmeasured"),
}
# Why a counter is unknown, short enough for a card number (32 characters with "unknown: ").
REASON = {
    "no-state-dir": "tool never ran here", "field-absent": "not recorded yet", "source-truncated": "source cut short",
    "source-unreadable": "source unreadable", "not-measurable": "not measurable", "no-reading": "no reading",
    "conflict": "lines disagree", "mixed": "reasons differ", "no-ledger": "no ledger yet", "ledger-unreadable": "ledger unreadable",
}
# The counter names the spec lists per tool (docs/ledger-spec.md, "Counters"): the only names a card prints.
VOCAB = frozenset(n for p in ledger.PROFILES.values() for n in [*p["events"], *(x for s in p["shares"] for x in (s["num"], *s["den"]))]) | {
    "pushes_ok", "pushes_rejected", "feeds_missed", "calls_raised", "landed", "restarts", "silence_episodes", "surfaced_cleared", "views",
    "explain_verdicts", "finding_episodes", "repairs_verified", "repairs_failed", "repairs_refused", "took_ms_p95", "judged_real",
    "judged_wrong", "jobs_finished", "jobs_placed_elsewhere", "queued_s_sum", "jobs_waited_60s", "gate_refused", "gate_unchecked",
    "passport_exported", "passport_imported", "passport_confirmed", "passport_refused", "drain_transitions", "drain_requests",
    "offers", "offers_moved", "drains_completed", "pass_receipts", "hosted_runs", "hosted_minutes", "est_cost", "overrides",
    "gate_go", "refusals_stood", "minutes_not_dispatched_upper", "surfaced_failed", "events_missed"}
OTHER = "other counter, not in vocabulary"
RETIRED_SKIP = "retired-word-in-counter"
_memo = {}


def settings():
    return config.get().get("ledger") or {}


def directory(cfg=None):
    d = (cfg or settings()).get("dir")
    return os.path.expanduser(d) if d else str(config.data_dir() / "ledger")


def day_end(now):
    """The end of the last closed UTC day: the window ends here, and the reader never reads a clock."""
    return int(now // DAY) * DAY


def _date(epoch):
    return time.strftime("%Y-%m-%d", time.gmtime(epoch))


def _fmt(epoch):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch))


def _clip(text, n):
    return text if len(text) <= n else text[:n - 1].rstrip() + "…"


def _num(v):
    return str(int(v)) if float(v).is_integer() else ("%.3f" % v).rstrip("0").rstrip(".")


def say(c):
    """One counter, as a card number's value: a number only when it is covered and exact, else words that say what it is not."""
    if c["value"] is None:
        return "unknown: " + REASON.get(c["unknown"], str(c["unknown"]).replace("-", " "))
    pct = "%d%% covered" % math.floor(round(c["coverage"] * 100, 6))  # rounded down: coverage is never rounded up
    if c["status"] == "blind":
        return "unknown: " + pct
    n = _num(c["value"])
    if c["status"] == "partial":
        return _clip("at least %s, %s" % (n, pct), 32)
    if c["quality"] == "lower-bound":
        return _clip("at least " + n, 32)
    if c["quality"] == "estimate":
        return _clip("about %s (estimate)" % n, 32)
    if c["quality"] == "rebuilt":
        return _clip("%s (rebuilt)" % n, 32)
    return float(c["value"]) if not float(c["value"]).is_integer() else int(c["value"])


def numbers(tool, counters):
    """The counters the reading rule uses first, then the rest by name, any not in VOCAB last and under OTHER; at most six, a
    "not shown" when there are more, and a last "not measured" counting the placeholders under a retired name."""
    prof = ledger.PROFILES.get(tool) or {"events": {}, "shares": []}
    first = list(prof["events"])
    for s in prof["shares"]:
        first += [s["num"], *s["den"]]
    held = [n for n in counters if ledger.retired(n)]
    rest = sorted(n for n in counters if n not in first and n not in held)
    order = [n for n in dict.fromkeys(first) if n in counters] + [n for n in rest if n in VOCAB] + [n for n in rest if n not in VOCAB]
    room = MAX_NUMBERS - (1 if held else 0)
    shown = order if len(order) <= room else order[:room - 1]
    out = [{"label": n.replace("_", " ")[:32] if n in VOCAB else OTHER, "value": say(counters[n])} for n in shown]
    if len(order) > len(shown):
        out.append({"label": "more counters", "value": "+%d not shown" % (len(order) - len(shown))})
    if held:
        out.append({"label": "not measured", "value": "%d counter%s" % (len(held), "" if len(held) == 1 else "s")})
    return out


def _headline(read):
    v, win = read["verdict"], read["window"]
    span = "%d days to %s" % (win["days"], _date(win["to"] - 1))
    reading = v["reading"]
    word = READING[reading][2]
    if reading == "KEEP":
        events = ", ".join("%s %s" % (_num(v["events"][n]), v["verbs"].get(n, n.replace("_", " "))) for n in sorted(v["events"]))
        text = "%s: %s in %s%s." % (word, events, span, " (at least: not fully covered)" if v["lower_bound"] else "")
    elif reading == "QUIET":
        text = "%s: no value event in %s; every counter covered." % (word, span)
    elif reading == "CUT-CANDIDATE":
        text = "%s: %s (%s). A person decides." % (word, "; ".join(v["why"]), span)
    else:
        why = ["no reading rule for this tool" if w == "no-rule-for-tool" else w.replace("_", " ") for w in v["why"]]
        text = "%s: no keep or cut call yet (%s), %s." % (word, ", ".join(why), span)
    skipped = len(read["file"]["skipped"])
    if skipped:
        text += " %d line%s skipped." % (skipped, "" if skipped == 1 else "s")
    return _clip(text, HEADLINE)


def card(tool, state, read, now):
    """One card from a tool's ledger. state: ok, missing, unreadable or large; read is ledger.read's result when state is ok."""
    base = {"schema": "lookout.card", "schema_version": "1.0", "tool": "ledger-" + tool, "title": _clip(tool.capitalize() + " ledger", 60),
            "updated_at": _fmt(now)}
    if state != "ok":
        words = {"missing": "No ledger yet: nothing to read for this tool.",
                 "unreadable": "No ledger yet: the file could not be read.",
                 "large": "No ledger read: the file is larger than the limit, ledger.max_kb."}
        return dict(base, status="unknown", mode="unmeasured", headline=words[state])
    if any(s["reason"] == RETIRED_SKIP for s in read["file"]["skipped"]):
        return dict(base, status="unknown", mode="unmeasured", headline="Ledger not valid: a counter name uses a retired word")
    status, mode, _ = READING[read["verdict"]["reading"]]
    return dict(base, status=status, mode=mode, headline=_headline(read), numbers=numbers(tool, read["counters"]))


def _stamp(path, limit):
    """-> (state, stamp) from one lstat: a symlink or a non-file is unreadable, and a file over the limit is not read."""
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return "missing", None
    except OSError:
        return "unreadable", None
    if not stat.S_ISREG(st.st_mode):
        return "unreadable", None
    if st.st_size > limit:
        return "large", (st.st_mtime_ns, st.st_size)
    return "ok", (st.st_mtime_ns, st.st_size)


def build(now=None):
    """The ledger cards for the tools the config asks for, or [] while it is off. One stat per tool per call; a file is read again
    only when it changed or the day ended."""
    cfg = settings()
    if not cfg.get("enabled"):
        return []
    now = now or time.time()
    to = day_end(now)
    folder = directory(cfg)
    hosts = tuple(h for h in cfg.get("expected_hosts") or [] if isinstance(h, str) and HOST_RE.match(h))
    limit = int(cfg.get("max_kb") or 8192) * 1024
    tools = [t for t in dict.fromkeys(cfg.get("tools") or []) if isinstance(t, str) and TOOL_RE.match(t)][:MAX_TOOLS]
    for gone in set(_memo) - set(tools):
        del _memo[gone]
    out = []
    for tool in tools:
        path = os.path.join(folder, tool + ".jsonl")
        state, stamp = _stamp(path, limit)
        read = None
        if state == "ok":
            key = (path, stamp, to, hosts)
            hit = _memo.get(tool)
            if hit and hit[0] == key:
                read = hit[1]
            else:
                read = ledger.read(path, to, expected_hosts=hosts, tool=tool)
                if read["file"]["state"] != "ok":      # it vanished or failed between the stat and the read
                    state, read = read["file"]["state"], None
                else:
                    _memo[tool] = (key, read)
        out.append(card(tool, state, read, now))
    return out
