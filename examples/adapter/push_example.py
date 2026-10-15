#!/usr/bin/env python3
"""A tiny generic adapter: turn a hand-edited work list plus this machine's vitals into a
lookout.feed document and push it to every enabled host in sinks.txt.

    python3 push_example.py --work work.json --sinks sinks.txt           # push every 30 s
    python3 push_example.py --work work.json --sinks sinks.txt --once    # push once and exit
    python3 push_example.py --work work.json --sinks sinks.txt --back-off 1.5   # slow down on a busy machine, and say so

Standard library only. It shows the three things any adapter needs: build the document, give it
a per-sink sequence number, and treat a host that is down as normal (one log line when it goes
down, one when it comes back, retry with backoff, never delay the other hosts). With --back-off it shows a fourth: a
tool that runs on someone's machine gives way when the machine is busy and says so in the feed (`pace`, feed 1.4), so the
board reads its slower reports as slowed on purpose, not as silence.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request


def now_iso(t=None):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t or time.time()))


def machine_row(machine_id):
    load = os.getloadavg() if hasattr(os, "getloadavg") else None  # not available on Windows
    disk = shutil.disk_usage(os.path.abspath(os.sep))
    return {"id": machine_id, "label": machine_id, "role": "this machine", "status": "ok", "as_of": now_iso(),
            "load": {"l1": round(load[0], 2), "l5": round(load[1], 2), "cores": os.cpu_count()} if load else None,
            "disks": [{"label": "disk", "free_gb": round(disk.free / 1e9), "free_pct": round(100 * disk.free / disk.total),
                       "warn_gb": 20, "crit_gb": 5}]}


def pace_for(every, threshold):
    """The whole back-off of this example: every interval is stretched by one step for each multiple of `threshold` of
    1-minute load per core (at most 4x). Returns (factor, the feed's `pace` object)."""
    load = os.getloadavg()[0] / (os.cpu_count() or 1) if hasattr(os, "getloadavg") else None
    factor = min(4, 1 + int(load // threshold)) if load is not None and threshold else 1
    return factor, {"factor": factor, "why": ["load"] if factor > 1 else [], "since": None, "pass_s": every * factor,
                    "normal_pass_s": every, "keepalive_s": every * factor, "normal_keepalive_s": every,
                    "load_per_core": round(load, 2) if load is not None else None}


def build(work, interval, boot_id, seq, pace=None):
    src = dict(work["source"])
    machine_id = src.setdefault("machine", src["id"])
    items = []
    for it in work.get("items", []):
        pct = it.get("percent")
        items.append({
            "id": it["id"], "group": it.get("group"), "machine": machine_id, "title": it.get("title", it["id"]),
            "state": it.get("state", "running"), "doing": it.get("doing"),
            # feed 1.1, all optional: a project chip, the row's one line, and what a held item waits on (and until when)
            "project": it.get("project"), "summary": it.get("summary"), "waiting_on": it.get("waiting_on"), "until": it.get("until"),
            "progress": {"basis": "coarse" if pct is None else "default", "percent_floor": pct, "percent_ceiling": pct,
                         "reason": "no percentage given" if pct is None else None, "steps": []},
        })
    feed = {"schema": "lookout.feed", "schema_version": "1.4" if pace else "1.1", "source": src,
            "producer": {"name": "push_example", "version": "1", "boot_id": boot_id, "seq": seq, "mode": "live"},
            "generated_at": now_iso(), "interval_s": interval, "machines": [machine_row(machine_id)], "items": items,
            "attention": work.get("attention", []), "next": work.get("next", []), "done": work.get("done", []),
            "groups": work.get("groups", [])}
    if pace:
        feed["pace"] = pace
    return feed


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
        return False, f"unknown transport {sink['transport']!r} (this example does http and local)", False
    except Refused as exc:
        return False, str(exc), True
    except urllib.error.HTTPError as exc:
        return False, f"HTTP {exc.code}: {exc.read().decode(errors='replace').strip()}", False
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        return False, str(exc), False


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--work", required=True, help="JSON file: {source, items, attention, next, done, groups}")
    ap.add_argument("--sinks", required=True, help="one host per line: name transport target credential")
    ap.add_argument("--every", type=int, default=30)
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--back-off", type=float, metavar="LOAD_PER_CORE",
                    help="stretch every interval one step for each multiple of this 1-minute load per core, and say so in the feed")
    args = ap.parse_args()
    boot_id = f"example-{int(time.time())}"
    where = ", ".join(f"{k['name']} ({k['target']})" for k in read_sinks(args.sinks)) or "no host (every line in the sinks file is off or empty)"
    print(f"push_example: pushing to {where}" + (" once" if args.once else f" every {args.every} s until Ctrl-C"), flush=True)
    state = {}  # per sink: seq, down flag, next attempt, backoff
    while True:
        work = json.load(open(args.work, encoding="utf-8"))
        factor, pace = pace_for(args.every, args.back_off) if args.back_off else (1, None)
        for sink in read_sinks(args.sinks):
            st = state.setdefault(sink["name"], {"seq": 0, "down": False, "next": 0, "backoff": args.every})
            if time.time() < st["next"]:
                continue
            st["seq"] += 1
            ok, text, refused = send(sink, json.dumps(build(work, args.every * factor, boot_id, st["seq"], pace)).encode())
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
        time.sleep(args.every * factor)


if __name__ == "__main__":
    sys.exit(main())
