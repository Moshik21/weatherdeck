#!/usr/bin/env python3
"""Put a firstmate home on the board: read its fleet ledger (and, when present, its lane-capacity file), turn what they
record into a lookout.feed document and push it to every enabled host in sinks.txt.

    python3 firstmate_push.py --home ~/firstmate --sinks sinks.txt            # push every 60 s
    python3 firstmate_push.py --home ~/firstmate --sinks sinks.txt --once     # push once and exit
    python3 firstmate_push.py --home ~/firstmate --print                      # print the feed that would be pushed, push nothing

Standard library only, read-only (it opens two files in <home>/state and writes nothing anywhere), no model calls. It
reads only firstmate's documented outputs: state/fleet-ledger.jsonl (fleet-ledger.v1, written when the home has
config/fleet-ledger) and, when it exists, state/lane-capacity.json (fm-lane-capacity.v1). It never runs a firstmate
script. See README.md, "Feed it from a firstmate home", for the mapping and for what the ledger cannot say.
"""
import argparse
import json
import math
import os
import re
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.request

VERSION = "1"
CAP_ITEMS, CAP_DONE = 60, 30              # the host rejects a push over these (docs/feed-spec.md, Envelope)
TEXT_MAX = 300                            # a status line is cut here, with an ellipsis; the ledger itself allows 2000
LINE_MAX = 65536                          # a ledger line longer than this is not a ledger record
CAPACITY_STALE_S = 600                    # the lane-capacity file is republished about every 30 s while the home runs
TASK_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
WORD_RE = re.compile(r"^[a-z][a-z-]{0,29}$")
URL_RE = re.compile(r"^https?://[^\s<>\"']{1,500}$")
# A worker's leading status word -> item state. A word not listed here (resolved, parked, anything new) is `unknown`: it
# says a thing happened, not what the work is doing now.
STATE_OF = {"working": "running", "needs-decision": "waiting", "blocked": "blocked", "paused": "paused",
            "done": "done", "failed": "failed"}
KINDS = ("ship", "scout", "secondmate")


class Nothing(Exception):
    """There is nothing readable to report (no ledger, or one that cannot be opened). The caller pushes nothing."""


def now_iso(t=None):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() if t is None else t))


def clean(value, limit=TEXT_MAX):
    """Untrusted text for display: a string with control characters turned to spaces, whitespace collapsed, cut at `limit`."""
    if not isinstance(value, str):
        return None
    text = " ".join("".join(" " if unicodedata.category(c) in ("Cc", "Cf", "Cs", "Zl", "Zp") else c for c in value).split())
    return (text[:limit - 1].rstrip() + "…" if len(text) > limit else text) or None


def number(value, lo=0, hi=4e9):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and lo <= value <= hi else None


def read_ledger(path):
    """Return (records, unusable): the usable v1 records in file order, and how many lines were not one. A last line with no
    newline is a write in progress (or a cut file) and is not read. Unknown events and members are kept for the caller to
    ignore. Raises Nothing when the file is absent or cannot be opened."""
    records, bad = [], 0
    try:
        f = open(path, "rb")
    except FileNotFoundError:
        raise Nothing("no ledger at %s (the home has no config/fleet-ledger, or nothing has been recorded yet)" % path) from None
    except OSError as exc:
        raise Nothing("cannot open the ledger at %s (%s)" % (path, exc.strerror or "error")) from None
    with f:
        while True:
            raw = f.readline(LINE_MAX)
            if not raw:
                break
            if not raw.endswith(b"\n"):
                bad += 1
                while raw and len(raw) == LINE_MAX and not raw.endswith(b"\n"):   # skip the rest of an over-long line
                    raw = f.readline(LINE_MAX)
                continue
            if not raw.strip():
                continue
            try:
                rec = json.loads(raw.decode("utf-8", "replace"))
            except (ValueError, RecursionError):
                bad += 1
                continue
            if (isinstance(rec, dict) and type(rec.get("v")) is int and rec["v"] == 1 and isinstance(rec.get("event"), str)
                    and isinstance(rec.get("task"), str) and TASK_RE.fullmatch(rec["task"]) and number(rec.get("ts")) is not None):
                records.append(rec)
            else:
                bad += 1
    return records, bad


def fold(records):
    """Walk the records in file order and return (open, landed): the tasks that are neither merged nor cleaned up, and the
    ones that finished (a merge, or a cleanup with no merge before it, which is titled as such). The ledger has no sequence
    numbers and is delivered at least once, so a record is trusted for what it says and not for its place: a record seen
    again whole is skipped, a repeated status changes nothing, a repeated merge or cleanup is one row, and the last record wins."""
    cur, landed, seen = {}, [], set()

    def start(task, dispatch=None, stray=False):
        cur[task] = {"task": task, "dispatch": dispatch, "word": None, "since": None, "text": None, "pr": None,
                     "last": 0, "closed": False, "stray": stray}
        return cur[task]

    def live(r):
        """The task's open stretch of records. A record after a merge or a cleanup that no dispatch follows is a stray."""
        inc = cur.get(r["task"])
        return inc if inc and not inc["closed"] else start(r["task"], stray=inc is not None)

    for r in records:
        ev, ts = r["event"], r["ts"]
        key = json.dumps(r, sort_keys=True)
        if key in seen:
            continue                                                       # the same record, delivered again
        seen.add(key)
        if ev == "task.dispatched":
            inc = cur.get(r["task"])
            if inc and not inc["closed"] and inc["dispatch"] is None:     # its statuses were recorded first
                inc["dispatch"], inc["stray"] = r, False
            elif not (inc and not inc["closed"] and all(inc["dispatch"].get(k) == r.get(k) for k in ("kind", "project", "harness", "model"))):
                inc = start(r["task"], r)                                  # a new launch; a repeat of the same one is skipped
        elif ev == "task.status":
            inc = live(r)
            word = r.get("state") if isinstance(r.get("state"), str) and WORD_RE.fullmatch(r["state"]) else None
            if word != inc["word"] or inc["since"] is None:
                inc["since"] = ts
            inc["word"], inc["text"] = word, r.get("text")
        elif ev == "task.pr_ready":
            inc = live(r)
            inc["pr"] = r["pr"] if isinstance(r.get("pr"), str) and URL_RE.fullmatch(r["pr"]) else inc["pr"]
        elif ev == "task.merged":
            inc = cur.get(r["task"])
            if inc and inc["closed"]:
                continue                                                   # the same merge, recorded again
            inc = live(r)
            pr = r["pr"] if isinstance(r.get("pr"), str) and URL_RE.fullmatch(r["pr"]) else inc["pr"]
            landed.append({"task": r["task"], "at": ts, "via": r["via"] if r.get("via") in ("pr", "local") else None, "pr": pr,
                           "title": r["task"]})
            inc["closed"] = True
        elif ev == "task.cleaned_up":
            inc = cur.get(r["task"])
            if not inc:
                continue                                                   # a cleanup for work the ledger never saw begin
            if not inc["closed"] and not inc["stray"]:
                landed.append({"task": r["task"], "at": ts, "via": None, "pr": None,
                               "title": r["task"] + " (cleaned up, no merge recorded)"})
            inc["closed"] = True
        else:
            continue                                                       # an event this reader does not know
        inc["last"] = ts
    return [i for i in cur.values() if not i["closed"] and not i["stray"]], landed


def read_capacity(path):
    """Return (facts, error): the lane-capacity file's facts, or why it could not be used. (None, None) when it is absent:
    the file is optional and its producer is not in every firstmate."""
    try:
        with open(path, "rb") as f:
            doc = json.loads(f.read(1 << 20).decode("utf-8", "replace"))
    except FileNotFoundError:
        return None, None
    except OSError as exc:
        return None, "cannot be opened (%s)" % (exc.strerror or "error")
    except (ValueError, RecursionError):
        return None, "is not JSON"
    if not isinstance(doc, dict) or doc.get("schema") != "fm-lane-capacity.v1":
        return None, "is not fm-lane-capacity.v1"
    at = number(doc.get("generated_epoch"))
    if at is None:
        return None, "carries no generated_epoch, so its age is unknown"
    lanes, pressure = doc.get("lanes"), doc.get("pressure")
    count = lanes.get("count") if isinstance(lanes, dict) else None
    level = pressure.get("level") if isinstance(pressure, dict) else None
    why = pressure.get("why") if isinstance(pressure, dict) else None
    return {"at": at, "machine": clean(doc.get("machine"), 48),
            "lanes": count if type(count) is int and count >= 0 else None,
            "level": level if level in ("ok", "warn", "critical") else None,    # "unknown" stays absent, not ok
            "why": [w for w in (clean(x, 200) for x in why[:8]) if w] if isinstance(why, list) else []}, None


def collect(home, machine=None, now=None):
    """Read the home and return the parts of the feed. Raises Nothing when there is no ledger to read."""
    now = now or time.time()
    state = os.path.join(home, "state")
    records, bad = read_ledger(os.path.join(state, "fleet-ledger.jsonl"))
    open_tasks, landed = fold(records)
    cap, cap_error = read_capacity(os.path.join(state, "lane-capacity.json"))
    machine = clean(machine, 48) or (cap or {}).get("machine")
    as_of = now_iso(now)

    open_tasks.sort(key=lambda i: (-i["last"], i["task"]))
    items = []
    for inc in open_tasks[:CAP_ITEMS]:
        d = inc["dispatch"] or {}
        state_word = STATE_OF.get(inc["word"], "unknown")
        item = {"id": inc["task"], "title": inc["task"], "machine": machine,
                "kind": d.get("kind") if d.get("kind") in KINDS else None, "project": clean(d.get("project"), 64),
                "state": state_word, "started_at": now_iso(d["ts"]) if d else None,
                "state_since": now_iso(inc["since"]) if inc["since"] is not None else None,
                # The ledger records no liveness: leaving this unknown is the honest answer, and a worker's last words
                # are never read as one.
                "agent": {"state": "unknown", "as_of": as_of, "reason": "the fleet ledger records no liveness"},
                "link": {"url": inc["pr"], "label": "pull request"} if inc["pr"] else None}
        # The worker's own words go in `doing` (or `state_detail` when it is not running), never in `summary`.
        item["doing" if state_word == "running" else "state_detail"] = clean(inc["text"])
        items.append({k: v for k, v in item.items() if v is not None})

    done = []
    for row in sorted(landed, key=lambda r: (-r["at"], r["task"]))[:CAP_DONE]:
        done.append({k: v for k, v in {"id": "%s@%d" % (row["task"], row["at"]), "title": row["title"], "via": row["via"],
                                       "link": {"url": row["pr"], "label": "pull request"} if row["pr"] else None,
                                       "at": now_iso(row["at"])}.items() if v is not None})

    omitted, why = [], []
    if len(open_tasks) > CAP_ITEMS:
        why.append("one push carries %d items; these are the most recently active" % CAP_ITEMS)
    homes = (cap or {}).get("lanes")
    if homes is not None and homes > len(open_tasks):
        why.append("the home counts %d open lanes (lane-capacity as of %s) and the ledger shows %d of them as not yet merged or "
                   "cleaned up; the rest have no open ledger record" % (homes, now_iso(cap["at"]), len(open_tasks)))
    if why:
        omitted.append({"surface": "items", "shown": len(items), "total": max(len(open_tasks), homes or 0), "reason": "; ".join(why)})
    if len(landed) > CAP_DONE:
        omitted.append({"surface": "done", "shown": len(done), "total": len(landed), "reason": "one push carries %d finished tasks; "
                        "these are the newest" % CAP_DONE})

    collectors = [{"id": "items", "label": "firstmate ledger", "as_of": as_of, "status": "ok", "warnings": bad}]
    if bad and not records:
        # Lines but none usable: this cannot say that nothing is open, so the surface is reported as failed, not as empty.
        collectors[0].update(status="error", error="state/fleet-ledger.jsonl has %d line(s) and none is a usable record, so what is open is not known" % bad)
    if cap:
        collectors.append({"id": "machines", "label": "lane-capacity", "as_of": now_iso(cap["at"]), "stale_after_s": CAPACITY_STALE_S,
                           "status": "ok"})
    elif cap_error:
        collectors.append({"id": "machines", "label": "lane-capacity", "status": "error", "error": "state/lane-capacity.json " + cap_error})

    machines = []
    if cap and machine:
        row = {"id": machine, "status": "unknown", "as_of": now_iso(cap["at"])}
        if cap["lanes"] is not None:
            row["lanes"] = {"total": cap["lanes"]}       # the home's own count; how many of them are running is not recorded
        if cap["level"]:
            row["pressure"] = {"level": cap["level"], "why": cap["why"]}
        machines.append(row)
    return {"items": items, "done": done, "machines": machines, "collectors": collectors, "omitted": omitted}


def build(parts, source_id, interval, boot_id, seq, now=None):
    # No source.machine: this source reports a home's lanes, not the machine itself, so it never takes a machine's row
    # from the source that measures that machine.
    return {"schema": "lookout.feed", "schema_version": "1.12", "source": {"id": source_id},
            "producer": {"name": "firstmate_push", "version": VERSION, "boot_id": boot_id, "seq": seq, "mode": "live"},
            "generated_at": now_iso(now), "interval_s": interval, "collectors": parts["collectors"], "machines": parts["machines"],
            "items": parts["items"], "attention": [], "next": [], "done": parts["done"], "omitted": parts["omitted"]}


def read_sinks(path):
    sinks = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("!"):
            continue
        parts = line.split(None, 3)
        if len(parts) >= 3:
            sinks.append({"name": parts[0], "transport": parts[1], "target": parts[2], "cred": parts[3] if len(parts) > 3 else "-"})
    return sinks


class Refused(Exception):
    """A sink this adapter cannot even try, named plainly (not the host being down)."""


def credential(spec):
    if spec.startswith("token-file:"):
        path = os.path.expanduser(spec[11:])
        try:
            return open(path, encoding="utf-8").read().strip()
        except FileNotFoundError:
            raise Refused(f"token file not found: {path}") from None
    if spec.startswith("env:"):
        return os.environ.get(spec[4:], "")
    return None


def send(sink, body):
    """Return (ok, text, refused). Raises nothing. `refused` is true when this adapter would not send at all
    (a missing token file), as opposed to a host that did not answer."""
    try:
        if sink["transport"] == "http":
            req = urllib.request.Request(sink["target"].rstrip("/") + "/api/ingest", data=body, method="POST",
                                         headers={"Content-Type": "application/json"})
            token = credential(sink["cred"])
            if token:
                req.add_header("Authorization", "Bearer " + token)
            with urllib.request.urlopen(req, timeout=8) as resp:
                return True, resp.read().decode().strip(), False
        if sink["transport"] == "local":
            res = subprocess.run([sink["target"], "ingest"], input=body, capture_output=True, timeout=20)
            return res.returncode == 0, res.stdout.decode().strip(), False
        return False, f"unknown transport {sink['transport']!r} (this adapter does http and local)", False
    except Refused as exc:
        return False, str(exc), True
    except urllib.error.HTTPError as exc:
        return False, f"HTTP {exc.code}: {exc.read().decode(errors='replace').strip()}", False
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        return False, str(exc), False


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--home", required=True, help="the firstmate home (the folder that holds state/)")
    ap.add_argument("--sinks", help="one host per line: name transport target credential")
    ap.add_argument("--source", default="firstmate", help="source id; use one per home (default: firstmate)")
    ap.add_argument("--machine", help="the machine id the home runs on; default: the machine lane-capacity names, else none")
    ap.add_argument("--every", type=int, default=60)
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--print", action="store_true", help="print the feed and exit; push nothing")
    args = ap.parse_args()
    if not args.print and not args.sinks:
        ap.error("give --sinks, or --print to see the feed without pushing it")
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,47}", args.source):
        ap.error("--source: use 1-48 characters from a-z 0-9 . _ - starting with a letter or digit")
    boot_id = f"firstmate-{int(time.time())}"
    if args.print:
        try:
            print(json.dumps(build(collect(args.home, args.machine), args.source, args.every, boot_id, 1), indent=2))
        except Nothing as exc:
            print(f"firstmate_push: nothing to push: {exc}", file=sys.stderr)
        return 0
    where = ", ".join(f"{k['name']} ({k['target']})" for k in read_sinks(args.sinks)) or "no host (every line in the sinks file is off or empty)"
    print(f"firstmate_push: pushing {args.home} as {args.source} to {where}" + (" once" if args.once else f" every {args.every} s until Ctrl-C"), flush=True)
    state, quiet = {}, False  # per sink: seq, down flag, next attempt, backoff; and whether the last pass had nothing to read
    while True:
        try:
            parts = collect(args.home, args.machine)
            if quiet:
                print("firstmate_push: the ledger is readable again")
            quiet = False
        except Nothing as exc:
            if not quiet:
                print(f"firstmate_push: nothing to push: {exc}; pushing nothing, so the board will show this source as silent")
            parts, quiet = None, True
        for sink in read_sinks(args.sinks) if parts else []:
            st = state.setdefault(sink["name"], {"seq": 0, "down": False, "next": 0, "backoff": args.every})
            if time.time() < st["next"]:
                continue
            st["seq"] += 1
            ok, text, refused = send(sink, json.dumps(build(parts, args.source, args.every, boot_id, st["seq"])).encode())
            if ok:
                if st["down"]:
                    print(f"{sink['name']}: back up")
                st.update(down=False, backoff=args.every, next=0)
            else:
                st["seq"] -= 1  # nothing was accepted, so the host never saw this number
                if not st["down"]:
                    print(f"{sink['name']}: {text}; retrying quietly" if refused else f"{sink['name']}: down ({text}); retrying quietly")
                st.update(down=True, backoff=min(st["backoff"] * 2, 300))
                st["next"] = time.time() + st["backoff"]
        if args.once:
            return 0
        time.sleep(args.every)


if __name__ == "__main__":
    sys.exit(main())
