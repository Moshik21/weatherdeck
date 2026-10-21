#!/usr/bin/env python3
"""Show Cua Spaces and their agent runs on the board: poll the `cua` command-line tool and push a lookout.feed document
to every enabled host in sinks.txt.

    python3 cua_push.py --sinks sinks.txt                  # poll and push every 60 s
    python3 cua_push.py --sinks sinks.txt --once           # push once and exit
    python3 cua_push.py --fixture DIR                      # read recorded cua output from DIR, print the feed, push nothing

Standard library only, read-only, no model calls. It runs these read-only commands and nothing else, and every shape it
reads from them is ASSUMED from Cua's published description, not checked against a live cua (docs/cua.md):
`cua --version`, `cua spaces ls --json`, `cua agent ls --json`, `cua agent status ID --json` (only for a run the list gives
no status for), `cua notifications ls --json` and `cua usage --json`. It never copies Cua code. Sinks and delivery are
push_example.py's, which this file imports, so keep the two side by side.
"""
import argparse
import calendar
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import time

from push_example import now_iso, read_sinks, send

VERSION = "1"
SOURCE_ID = "cua"
SURFACES = (("spaces", "machines", "cua spaces"), ("runs", "items", "cua agent runs"),
            ("notices", "attention", "cua notifications"), ("usage", "meters", "cua usage"))
MAX_STATUS_CALLS = 8         # `cua agent status` calls in one pass, at most
MAX_EXTRAS = 12              # a machine row's extras, the feed's limit
MAX_NEW_EVENTS = 20          # new turn-end events kept in one push
SLOW_EVERY_S = 300           # the version and the usage are read this seldom
OFFLINE = {"offline", "not sharing"}
ONLINE = {"ready", "running", "sharing"}      # assumed words; any other phase reads unknown
RUN_STATUS = {"running", "idle", "failed", "crashed", "unknown"}
ACCESS = {"access request"}
FAILURE = {"run failed", "run crashed"}
TURN_END = {"turn end"}
ANSWERED = {"approved"}
SIGNED_OUT = ("not signed in",)
NO_SUCH = ("unknown command",)
LANE_RANK = {"Needs attention": 0, "Waiting on the supervisor": 1, "Can't tell": 2, "Working": 3}


class Missing(Exception):
    """The cua command is not installed."""


class SignedOut(Exception):
    """cua is installed and says nobody is signed in."""


class Cli:
    """The cua command, or a folder of recorded output in its place (`--fixture DIR`): `spaces ls` reads spaces-ls.json,
    `--version` reads version.txt, and a recorded failure is spaces-ls.err (exit 1, that text on standard error). A command
    with no file is one this cua does not have."""

    def __init__(self, exe="cua", fixture=None):
        self.exe, self.fixture = exe, fixture
        if not fixture and not shutil.which(exe):
            raise Missing(f"the `{exe}` command is not installed or not on PATH")

    def run(self, args):
        """Return (exit code, standard output, standard error); a timeout is exit code 124."""
        if self.fixture:
            name = "version" if args == ["--version"] else "-".join(a for a in args if a != "--json")
            for suffix in (".err", ".json", ".txt"):
                path = os.path.join(self.fixture, name + suffix)
                if os.path.exists(path):
                    with open(path, encoding="utf-8") as fh:
                        text = fh.read()
                    return (1, "", text) if suffix == ".err" else (0, text, "")
            return 2, "", "unknown command"
        try:
            res = subprocess.run([self.exe] + args, capture_output=True, timeout=20)
        except subprocess.TimeoutExpired:
            return 124, "", "timed out after 20 s"
        except OSError as exc:
            raise Missing(f"the `{self.exe}` command could not be run ({exc})") from None
        return res.returncode, res.stdout.decode(errors="replace"), res.stderr.decode(errors="replace")


def clip(text, n=200):
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[:n - 1] + "…"


def word(value):
    """A status-like word folded for comparison: lower case, `_` and `-` as spaces. None when it is not text."""
    return re.sub(r"[_\s-]+", " ", value.strip().lower()) if isinstance(value, str) and value.strip() else None


def pick(row, *names):
    """The first of `names` that holds a name or an id in `row` (a text, a number, or an object with a name or id)."""
    for name in names:
        value = row.get(name)
        if isinstance(value, dict):
            value = value.get("name") or value.get("id")
        if isinstance(value, (str, int)) and not isinstance(value, bool) and str(value).strip():
            return str(value).strip()
    return None


def slug(text, fallback):
    return re.sub(r"[^a-z0-9._-]+", "-", text.lower()).strip("-._")[:48] or fallback


def to_iso(value):
    """A time Cua gave (epoch seconds, or an RFC 3339 string) as a feed time; None when it is neither."""
    try:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return now_iso(value) if value > 0 else None
        if isinstance(value, str):
            when = datetime.datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
            if when.tzinfo:
                return when.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (ValueError, OverflowError, OSError):
        pass
    return None


def to_epoch(iso):
    return calendar.timegm(time.strptime(iso, "%Y-%m-%dT%H:%M:%SZ"))


def rows_of(data, *keys):
    """The list of rows in a cua answer: the list itself, or the list under one of `keys`. None when it is neither."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in keys:
            if isinstance(data.get(key), list):
                return data[key]
    return None


def fetch(cli, *args):
    """Run one `cua ... --json` read: ("ok", data), ("off", why) for a verb this cua lacks, or ("bad", why)."""
    cmd = "cua " + " ".join(args)
    code, out, err = cli.run(list(args) + ["--json"])
    if code != 0:
        first = clip(err.strip().splitlines()[0]) if err.strip() else f"exit {code}"
        if any(w in err.lower() for w in SIGNED_OUT):
            raise SignedOut(first)
        if any(w in err.lower() for w in NO_SUCH):
            return "off", f"`{cmd}` is not offered by this cua"
        return "bad", f"`{cmd}` failed: {first}"
    try:
        return "ok", json.loads(out)
    except ValueError:
        return "bad", f"`{cmd}` did not print JSON"


def read_cua(cli, state, now):
    """One pass of reads: {spaces, runs, notices, usage: (status, data or why), usage_at, version}. Raises SignedOut, Missing."""
    got = {"spaces": fetch(cli, "spaces", "ls"), "runs": fetch(cli, "agent", "ls"), "notices": fetch(cli, "notifications", "ls")}
    rows = rows_of(got["runs"][1], "runs") if got["runs"][0] == "ok" else None
    # a run the list gives no status for is asked about by itself, a few at a time; the rest read unknown
    for row in [r for r in rows or [] if isinstance(r, dict) and not word(r.get("status")) and pick(r, "id")][:MAX_STATUS_CALLS]:
        status, detail = fetch(cli, "agent", "status", pick(row, "id"))
        if status == "ok" and isinstance(detail, dict):
            row["status"] = detail.get("status")
            for key in ("accepts_message", "liveness"):
                if key in detail:
                    row.setdefault(key, detail[key])
    if "usage" not in state or now - state["slow_at"] >= SLOW_EVERY_S:
        code, out, _ = cli.run(["--version"])
        found = re.search(r"\d+(?:\.\d+)+", out) if code == 0 else None
        state.update(slow_at=now, version=found.group(0) if found else None, usage=fetch(cli, "usage"), usage_at=now)
    got.update(usage=state["usage"], usage_at=state["usage_at"], version=state["version"])
    return got


class Report:
    """What each surface of the board could be read from, and the problems to say once."""

    def __init__(self, got):
        self.surface = {k: [got[k][0], got[k][1] if got[k][0] != "ok" else None, 0] for k, _, _ in SURFACES}
        self.notes = [(got[k][1] + (": nothing from it is shown" if got[k][0] == "off" else ": its part of the board is left empty, not zero"))
                      for k, _, _ in SURFACES if got[k][0] != "ok"]

    def bad(self, key, text):
        """The whole answer was of a shape this pusher does not know: the surface is an error, and says so once."""
        self.surface[key][:2] = ["bad", text]
        self.notes.append(text)

    def warn(self, key, text):
        """Some rows were left out or read unknown: the surface counts a warning and says so once."""
        self.surface[key][2] += 1
        self.notes.append(text)


def lane_of(status, accepts, host):
    """(item state, lane word, lane cause, summary, agent state or None) for one run. Only Cua's own words choose it;
    `host` is "offline" for a run on an offline host, "unreadable" for one on a Space whose phase is not a known one, "unlisted" for one
    whose Space the Spaces list does not show, else None."""
    if host == "offline":
        return "unknown", "Can't tell", "cua-host-offline", "its host is offline, so the run's state is not known", "unknown"
    if host == "unreadable":
        return "unknown", "Can't tell", "cua-space-phase-unknown", "its Space's phase is not one this pusher knows as up, so the run's state is not known", "unknown"
    if host == "unlisted":
        return "unknown", "Can't tell", "cua-space-unlisted", "its Space is not in the list of Spaces Cua printed, or its name fits more than one Space, so the run's state is not known", "unknown"
    if status == "running":
        return "running", "Working", "cua-run-running", "Cua reports it running", None
    if status == "idle":
        if accepts is True:
            return "waiting", "Waiting on the supervisor", "cua-run-idle-takes-message", "Cua reports it idle and ready for a message", None
        return "unknown", "Can't tell", "cua-run-idle", "Cua reports it idle; whether it waits for anyone is not reported", None
    if status == "failed":
        return "failed", "Needs attention", "cua-run-failed", "Cua reports the run failed", None
    if status == "crashed":
        return "failed", "Needs attention", "cua-run-crashed", "Cua reports the run crashed", "gone"
    if status == "unknown":
        return "unknown", "Can't tell", "cua-run-unknown", "Cua reports its state as unknown", "unknown"
    return "unknown", "Can't tell", "cua-run-status-unrecognised", "Cua reported a status this pusher does not know", "unknown"


def build_spaces(data, rep, now_s):
    """(machines, spaces by id and by name, omitted extras). A key two Spaces share maps to None, like a Space not listed. One machine per host, its Spaces in `extras`; no load, memory or disk, as cua has none."""
    rows = rows_of(data, "spaces")
    if rows is None:
        rep.bad("spaces", "`cua spaces ls` printed an unexpected shape; no machine is shown")
        return [], {}, []
    hosts, spaces, skipped = {}, {}, 0
    for row in rows:
        sid = pick(row, "id", "name") if isinstance(row, dict) else None
        if not sid:
            skipped += 1
            continue
        seen = {word(row.get("phase")), word(row.get("status"))} - {None}
        level = "offline" if seen & OFFLINE else "online" if seen & ONLINE else "unknown"
        host = pick(row, "host", "host_name")
        mid = slug(host, "cua-host-not-reported") if host else "cua-host-not-reported"
        for key in {pick(row, "id"), pick(row, "name")} - {None}:
            spaces[key] = None if key in spaces else {"level": level, "machine": mid}
        hosts.setdefault(mid, {"label": host, "spaces": []})["spaces"].append((pick(row, "name", "id"), level, word(row.get("phase")) or word(row.get("status"))))
    if skipped:
        rep.warn("spaces", f"`cua spaces ls`: {skipped} row(s) without an id were left out")
    machines, omitted = [], []
    for mid, host in hosts.items():
        levels = {lv for _, lv, _ in host["spaces"]}
        status = "down" if levels == {"offline"} else "warn" if "offline" in levels else "ok" if levels == {"online"} else "unknown"
        extras = [{"label": "space " + clip(n, 60), "value": clip(p or "no phase reported", 60), "severity": "warn" if lv == "offline" else None}
                  for n, lv, p in host["spaces"]]
        if len(extras) > MAX_EXTRAS:
            omitted.append({"surface": f"machines[{mid}].extras", "shown": MAX_EXTRAS - 1, "total": len(extras), "reason": "the feed carries at most 12 extras"})
            extras[MAX_EXTRAS - 1:] = [{"label": "more spaces", "value": len(extras) - MAX_EXTRAS + 1, "severity": None}]
        machines.append({"id": mid, "label": clip(host["label"], 60) if host["label"] else "host not reported", "role": "Cua host",
                         "status": status, "as_of": now_s, "extras": extras})
    return machines, spaces, omitted


def build_runs(data, rep, spaces, now_s):
    """(items, item id by run id, machines a left-out row may belong to). One item per run; the lane word and cause come from Cua's status alone.
    A left-out row names its Space's machine; one naming no usable Space could be on any, which is None in the set."""
    rows = rows_of(data, "runs")
    if rows is None:
        rep.bad("runs", "`cua agent ls` printed an unexpected shape; no run is shown")
        return [], {}, set()
    items, by_run, skipped, odd, dropped = [], {}, 0, set(), set()
    for row in rows:
        rid = pick(row, "id") if isinstance(row, dict) else None
        if not rid or rid in by_run:
            skipped += 1
            info = spaces.get(pick(row, "space")) if isinstance(row, dict) else None
            dropped.add(info["machine"] if info else None)
            continue
        space = pick(row, "space")
        info = spaces.get(space) if space else None
        status = word(row.get("status"))
        if status not in RUN_STATUS:
            odd.add(status or "none")
        host = "unlisted" if not info else {"offline": "offline", "unknown": "unreadable"}.get(info["level"])
        accepts = row.get("accepts_message") if isinstance(row.get("accepts_message"), bool) else None
        state, lane, cause, summary, agent = lane_of(status, accepts, host)
        live = {"alive": "alive", "crashed": "gone", "unknown": "unknown"}.get(word(row.get("liveness")))
        agent = live if live and not host else agent
        kind = pick(row, "agent")
        item = {"id": f"{space}:{rid}" if space else rid, "project": "Cua", "kind": kind, "machine": info["machine"] if info else None,
                "title": clip(pick(row, "name") or f"{kind or 'agent'} run {rid}", 120), "state": state, "summary": summary,
                "lane": {"state": lane, "cause": cause}, "started_at": to_iso(row.get("started_at"))}
        task = pick(row, "task")
        if task and state == "running":
            item["doing"] = clip(task)        # the run's own words go in `doing`, never in `summary`
        if agent:
            item["agent"] = {"state": agent, "as_of": now_s}
        items.append({k: v for k, v in item.items() if v is not None})
        by_run[rid] = item["id"]
    if skipped:
        rep.warn("runs", f"`cua agent ls`: {skipped} row(s) without an id, or repeating an earlier id, were left out")
    if odd:
        rep.warn("runs", "`cua agent ls`: unrecognised run status " + ", ".join(sorted(repr(w) for w in odd)) + "; those runs read Can't tell")
    return items, by_run, dropped


def build_notices(data, rep, by_run, seen):
    """(attention cards, new turn-end events). A turn end is said once per notification id (`seen`)."""
    rows = rows_of(data, "notifications")
    if rows is None:
        rep.bad("notices", "`cua notifications ls` printed an unexpected shape; no access request or failure is shown")
        return [], []
    cards, events, skipped, odd = [], [], 0, set()
    for row in rows:
        nid = pick(row, "id") if isinstance(row, dict) else None
        if not nid:
            skipped += 1
            continue
        kind, status = word(row.get("kind")), word(row.get("status"))
        if status in ANSWERED:
            continue                         # an ask whose answer is on record is never sent as a card
        at, text = to_iso(row.get("at")), clip(pick(row, "title", "message") or "")
        run = by_run.get(pick(row, "run") or "")
        if kind in ACCESS or kind in FAILURE:
            card = {"id": "cua-notice:" + nid, "kind": "approval" if kind in ACCESS else "decision", "severity": "action",
                    "title": "Cua access request" if kind in ACCESS else "A Cua run failed", "detail": text or "Cua gave no text",
                    "since": at, "item": run, "how": "answer it in Cua; the board is read-only"}
            cards.append({k: v for k, v in card.items() if v is not None})
        elif kind in TURN_END:
            if nid not in seen and at:
                events.append({"at": to_epoch(at), "item": run, "kind": "update", "text": "turn ended" + (": " + text if text else "")})
            seen.add(nid)
        else:
            odd.add(kind or "none")
    if skipped:
        rep.warn("notices", f"`cua notifications ls`: {skipped} row(s) without an id were left out")
    if odd:
        rep.warn("notices", "`cua notifications ls`: unrecognised kind " + ", ".join(sorted(repr(k) for k in odd)) + "; left out")
    return cards, [{k: v for k, v in e.items() if v is not None} for e in events[-MAX_NEW_EVENTS:]]


def build_usage(data, rep, usage_at):
    """One allowance chip with `runway` unknown, or None when no used/limit pair is readable (nothing is sent, not zero)."""
    if not isinstance(data, dict):
        rep.bad("usage", "`cua usage` printed an unexpected shape; no allowance is shown")
        return None
    windows = []
    for key, label, short in (("live_sessions", "Live sessions", "live"), ("remote_hours", "Remote hours", "hrs")):
        part = data.get(key)
        used, limit = (part.get("used"), part.get("limit")) if isinstance(part, dict) else (None, None)
        if all(isinstance(n, (int, float)) and not isinstance(n, bool) for n in (used, limit)) and limit > 0 and used >= 0:
            windows.append({"id": key, "label": label, "short": short, "percent_remaining": round(max(0.0, 100.0 * (1 - used / limit)), 1),
                            "resets_at": to_iso(part.get("resets_at"))})
    if not windows:
        rep.bad("usage", "`cua usage` gave no readable used and limit pair; no allowance is shown")
        return None
    account = {"id": "cua", "label": "Cua", "provider": "Cua", "windows": windows, "runway": {"status": "unknown"}}
    if isinstance(data.get("plan"), str) and data["plan"].strip():
        account["account"] = clip(data["plan"], 60)
    return {"as_of": now_iso(usage_at), "accounts": [account]}


def build(got, now, interval, boot_id, seq, seen, noted):
    """The whole current state as a lookout.feed document from one pass of readings. `seen` (turn-end ids) and `noted`
    (the cua version and the problems already said) are what makes events[] incremental; with them empty it is pure."""
    now_s, rep = now_iso(now), Report(got)
    machines, spaces, omitted = build_spaces(got["spaces"][1], rep, now_s) if got["spaces"][0] == "ok" else ([], {}, [])
    items, by_run, dropped = build_runs(got["runs"][1], rep, spaces, now_s) if got["runs"][0] == "ok" else ([], {}, set())
    cards, events = build_notices(got["notices"][1], rep, by_run, seen) if got["notices"][0] == "ok" else ([], [])
    meters = build_usage(got["usage"][1], rep, got["usage_at"]) if got["usage"][0] == "ok" else None
    items.sort(key=lambda i: (LANE_RANK.get(i["lane"]["state"], 4), i["id"]))
    lanes = {}
    for it in items:                            # the source's own count of runs per host; a host that is offline, has a run of unknown state, or may have had a run row left out, has no `running`
        row = lanes.setdefault(it.get("machine"), {"total": 0, "running": 0, "unread": False})
        row["total"] += 1
        row["running"] += it["state"] == "running"
        row["unread"] |= it["lane"]["cause"] in ("cua-host-offline", "cua-space-phase-unknown", "cua-run-unknown", "cua-run-status-unrecognised")
    for m in machines:
        if m["id"] in lanes:
            m["lanes"] = {"total": lanes[m["id"]]["total"]} if lanes[m["id"]]["unread"] or m["id"] in dropped or None in dropped else {"running": lanes[m["id"]]["running"], "total": lanes[m["id"]]["total"]}
    for surface, rows, cap in (("items", items, 60), ("attention", cards, 30), ("machines", machines, 12)):
        if len(rows) > cap:
            omitted.append({"surface": surface, "shown": cap, "total": len(rows), "reason": f"the feed carries at most {cap} {surface}"})
            del rows[cap:]
    version = got["version"]
    if version and noted.get("version") != version:
        rep.notes.append(f"read from cua {version}" + ("" if noted.get("version") is None else f" (was {noted['version']})") + "; its contract is experimental, so shapes may move")
    noted["version"] = version or noted.get("version")
    collectors = [{"id": "cua", "label": f"cua {version}" if version else "cua (version not reported)", "as_of": now_s, "status": "ok",
                   "stale_after_s": interval * 3}]
    for key, cid, label in SURFACES:
        status, why, warnings = rep.surface[key]
        col = {"id": cid, "label": label, "as_of": now_iso(got["usage_at"]) if key == "usage" else now_s, "stale_after_s": interval * 3,
               "status": {"ok": "ok", "off": "disabled", "bad": "error"}[status]}
        if why:
            col["error"] = why
        if warnings:
            col["warnings"] = warnings
        collectors.append(col)
    said = noted.setdefault("said", set())
    fresh = [n for n in dict.fromkeys(rep.notes) if n not in said]
    said.update(fresh)
    events += [{"at": int(now), "kind": "note", "text": f"{SOURCE_ID}: {n}"} for n in fresh]
    feed = {"schema": "lookout.feed", "schema_version": "1.12", "source": {"id": SOURCE_ID, "label": "Cua Spaces", "kind": "agent runner"},
            "producer": {"name": "cua_push", "version": VERSION, "boot_id": boot_id, "seq": seq, "mode": "live"},
            "generated_at": now_s, "interval_s": interval, "collectors": collectors, "machines": machines, "items": items,
            "attention": cards, "events": events[-200:], "omitted": omitted}
    if meters:
        feed["meters"] = meters
    return feed


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--sinks", help="one host per line: name transport target credential (not needed with --fixture)")
    ap.add_argument("--every", type=int, default=60, help="seconds between polls (default 60, at least 30: keep it modest)")
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--cua", default="cua", help="the cua command (default: cua)")
    ap.add_argument("--fixture", metavar="DIR", help="read recorded cua output from DIR, print the feed once and push nothing")
    args = ap.parse_args(argv)
    if not args.fixture and not args.sinks:
        ap.error("--sinks is required unless --fixture is given")
    every, once = max(30, args.every), args.once or bool(args.fixture)
    try:
        cli = Cli(args.cua, args.fixture)
    except Missing as exc:
        print(f"cua_push: {exc}; there is nothing to show and nothing is pushed", file=sys.stderr)
        return 0
    where = "a fixture folder (printing, not pushing)" if args.fixture else ", ".join(f"{k['name']} ({k['target']})" for k in read_sinks(args.sinks)) or "no host (every line in the sinks file is off or empty)"
    print(f"cua_push: reading cua, pushing to {where}" + (" once" if once else f" every {every} s until Ctrl-C"),
          file=sys.stderr if args.fixture else sys.stdout, flush=True)
    boot_id = f"cua-push-{int(time.time())}"
    state, seen, noted, hosts, said = {}, set(), {}, {}, set()
    while True:
        now = time.time()
        try:
            got = read_cua(cli, state, now)
            problem = None if any(got[k][0] == "ok" for k, _, _ in SURFACES) else "cua answered nothing readable; nothing is pushed"
        except SignedOut as exc:
            problem = f"cua is not signed in ({exc}); sign in with cua and this picks it up; nothing is pushed"
        except Missing as exc:
            problem = f"{exc}; nothing is pushed"
        if problem:
            if problem not in said:
                print(f"cua_push: {problem}", file=sys.stderr, flush=True)
                said.add(problem)
        else:
            said.clear()
            feed = build(got, now, every, boot_id, 0, seen, noted)
            if args.fixture:
                feed["producer"]["seq"] = 1
                print(json.dumps(feed, indent=2, sort_keys=True))
            for sink in [] if args.fixture else read_sinks(args.sinks):
                st = hosts.setdefault(sink["name"], {"seq": 0, "down": False, "next": 0, "backoff": every})
                if now < st["next"]:
                    continue
                st["seq"] += 1
                feed["producer"]["seq"] = st["seq"]
                ok, text, refused = send(sink, json.dumps(feed).encode())
                if ok:
                    if st["down"]:
                        print(f"{sink['name']}: back up")
                    st.update(down=False, backoff=every, next=0)
                else:
                    st["seq"] -= 1  # nothing was accepted, so the host never saw this number
                    if not st["down"]:
                        print(f"{sink['name']}: {text}; retrying quietly" if refused else f"{sink['name']}: down ({text}); retrying quietly")
                    st.update(down=True, backoff=min(st["backoff"] * 2, 300))
                    st["next"] = now + st["backoff"]
        if once:
            return 0
        time.sleep(every)


if __name__ == "__main__":
    sys.exit(main())
