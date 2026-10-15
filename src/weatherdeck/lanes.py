"""What the board says about one work item: its lane kind, its class in the five-state taxonomy, and its row text.

Pure functions: no I/O, no clock of their own, nothing about any particular tool. The host calls them while it builds
the view (docs/feed-spec.md, "Lanes on the board"); the page draws what they return. Silence is decided in the browser
(per source, from the host's clock), so the fifth class, quiet for a silent source, is applied there over these.

Classes:
    needs_action   someone must act: failed, blocked, a decision a call names (attention action on this item), or work
                   whose agent session ended or whose endpoint is gone for longer than the configured minutes
    running_long   at work beyond its typical time (p90), or flagged running_long by its source
    waiting        held on something named (waiting_on: gate, pr, human, capacity, quiet_hours), never an alarm
    quiet          no current word: the source does not know the state (and, in the page, a silent source)
    ok             moving, scouting, on another round, landed
Off course is needs_action plus running_long, and nothing else.
"""
import calendar
import re
import time

CLASSES = ("needs_action", "running_long", "waiting", "quiet", "ok")
OFF_COURSE = ("needs_action", "running_long")
WAITING_ON = ("gate", "pr", "human", "capacity", "quiet_hours", "external")
OUTSIDE = ("external", "pr")   # waits on someone outside the fleet: an upstream maintainer, a reviewer, a vendor
AGENT_GONE = ("ended", "gone")  # items[].agent.state that leaves work with nobody at it
STATES = ("running", "waiting", "done", "blocked", "paused", "failed", "unknown")

_PR = re.compile(r"^https?://[^/]+/([^/]+/[^/]+)/pull/(\d+)")
# A title that repeats its project: "Project: rest", "Project - rest", "Project — rest", "[Project] rest", "Project rest".
_SEPS = (":", " -", " –", " —", " |", " ·")


def pull_request(item):
    """{url, state, name} when the item's link is a pull request, else None."""
    link = item.get("link") or {}
    m = _PR.match(link.get("url") or "")
    return {"url": link["url"], "state": link.get("state"), "name": "%s#%s" % (m.group(1), m.group(2))} if m else None


def _pr_kind(item):
    """A run record that says failed (or done, or nothing) while its PR is open did its work and waits on review: never
    FAILED. A merged PR has landed. FAILED only when the PR was closed unmerged, or there is no PR."""
    pr = pull_request(item)
    if not pr or item.get("state") not in ("failed", "done", "unknown", None):
        return None
    if pr["state"] == "open":
        return "pr_open"
    if pr["state"] == "merged":
        return "done"
    if pr["state"] == "closed":
        return "failed" if item.get("state") == "failed" else None
    return "pr_unread" if item.get("state") == "failed" else None


def elapsed(item, grown_s=0.0):
    cur = (item.get("progress") or {}).get("current") or {}
    return cur["elapsed_s"] + grown_s if isinstance(cur.get("elapsed_s"), (int, float)) else None


def kind(item, grown_s=0.0):
    """The lane kind (the state word the board uses). grown_s is how far the step's clock has run since the source
    measured it (the host adds the time since the push, at most two intervals)."""
    prog = item.get("progress") or {}
    cur = prog.get("current") or {}
    hand = (item.get("handoff") or {}).get("state")
    state = item.get("state")
    if hand == "awaiting_you":
        return "approval"
    if state == "waiting" and item.get("needs_you"):
        return "call"
    by_pr = _pr_kind(item)
    if by_pr:
        return by_pr
    if state in ("done", "failed", "blocked"):
        return state
    if state is None or state == "unknown" or state not in STATES:
        return "unknown"
    if state in ("waiting", "paused"):
        return "mate"
    if item.get("kind") in ("investigation", "scout"):
        return "scout"
    el = elapsed(item, grown_s)
    if "running_long" in (item.get("flags") or []) or (isinstance(cur.get("p90_s"), (int, float)) and el is not None and el > cur["p90_s"]):
        return "long"
    if prog.get("regressed") or (cur.get("round") or 0) > 1:
        return "regressed"
    return "moving"


def agent_gone(item, now, after_s):
    """Seconds the item's agent has been gone (its session ended, or its endpoint no longer exists) when that is at least
    `after_s`, else None. Only what the source states counts: an agent that is idle between turns, or quiet while a long
    run it started goes on, is `alive`, and a missing or unknown agent state is never gone. Finished work needs no agent:
    done, failed (already needs action), an open PR, and a merged PR whatever the state says (a lane paused or still marked
    running after its PR merged is an old record, not trouble)."""
    ag = item.get("agent") if isinstance(item.get("agent"), dict) else None
    if not ag or ag.get("state") not in AGENT_GONE or now is None:
        return None
    if item.get("state") in ("done", "failed") or _pr_kind(item) in ("done", "pr_open", "pr_unread"):
        return None
    if (pull_request(item) or {}).get("state") == "merged":
        return None
    since = _epoch(ag.get("since"))
    gone = (now - since) if since is not None else None
    if gone is None or gone < max(0.0, after_s or 0.0):
        return None
    return gone


def _epoch(iso):
    if not isinstance(iso, str):
        return None
    try:
        return calendar.timegm(time.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S"))
    except ValueError:
        return None


def classify(item, grown_s=0.0, now=None, agent_gone_s=600.0):
    """-> {kind, cls, waiting_on, until, agent_gone_s}. Mapped from what the source says, never from silence. `now` is
    the host's clock (needed only for the agent rule); `agent_gone_s` how long an ended session or a gone endpoint is
    allowed before the work needs action."""
    gone = agent_gone(item, now, agent_gone_s)
    if gone is not None:
        return {"kind": "agent_gone", "cls": "needs_action", "waiting_on": None, "until": None, "agent_gone_s": round(gone)}
    k = kind(item, grown_s)
    named = item.get("waiting_on") if item.get("waiting_on") in WAITING_ON else None
    until = item.get("until")
    if k in ("failed", "blocked", "call") or (k == "approval" and item.get("needs_you")):
        cls = "needs_action"
    elif k == "long":
        cls = "running_long"
    elif k in ("mate", "approval", "pr_open", "pr_unread"):
        cls = "waiting"
        if named is None and k in ("pr_open", "pr_unread"):
            named = "pr"
        elif named is None and k == "approval":
            named = "pr" if pull_request(item) else "human"
    elif k == "unknown":
        cls = "quiet"
    else:
        cls = "ok"
    if cls != "waiting":
        named, until = None, None
    return {"kind": k, "cls": cls, "waiting_on": named, "until": until, "agent_gone_s": None}


def _clean(text):
    return " ".join(str(text).split()) if isinstance(text, str) and text.strip() else None


def _fold(text):
    """Case, hyphens and underscores do not matter when matching a project name ("harbor-app" is "Harbor App")."""
    return text.lower().replace("-", " ").replace("_", " ")


def strip_prefix(title, project):
    """The title without a leading repeat of its project ("Project: fix the thing" -> "fix the thing")."""
    if not title or not project:
        return title
    t, p = title.strip(), project.strip()
    if not p or len(t) <= len(p) + 1:
        return t
    low = _fold(t[:len(p) + 2])
    p = _fold(p)
    if low.startswith("[" + p + "]"):
        rest = t[len(p) + 2:]
    elif low.startswith(p):
        rest = t[len(p):]
        sep = next((s for s in _SEPS if rest.startswith(s)), None)
        if sep is None and not (rest[:1] == " " and project.isupper()):   # "ACME fix x": only an all-caps tag needs no mark
            return t
        rest = rest[len(sep):] if sep else rest
    else:
        return t
    rest = rest.lstrip(" :-–—|·")
    return rest if rest else t


def cut_words(text, limit, mark="…"):
    """Text cut to at most `limit` characters at a word boundary, with the mark when anything was cut."""
    text = _clean(text) or ""
    if len(text) <= limit:
        return text
    room = max(1, limit - len(mark))
    head = text[:room + 1]
    space = head.rfind(" ")
    head = head[:space] if space >= max(1, room // 2) else text[:room]
    return head.rstrip(" ,;:.-–—·") + mark


def row(item, group_label=None):
    """{chip, title, summary}: what a row shows. chip is the item's project (else its group's label); the title loses
    a leading repeat of the chip; summary is the source's one-line summary, else its 1.0 `doing` (or, for work that
    is not running, `state_detail`), on one line. The full text stays in the item for the opened row."""
    chip = _clean(item.get("project")) or _clean(group_label)
    title = _clean(item.get("title")) or str(item.get("id") or "")
    if chip:
        title = strip_prefix(title, chip)
    summary = _clean(item.get("summary"))
    if summary is None:
        summary = _clean(item.get("doing") if item.get("state") in ("running", None) else item.get("state_detail") or item.get("doing"))
    return {"chip": chip, "title": title, "summary": summary}
