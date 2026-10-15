"""The `weatherdeck` command: on / off / status, plus ingest, replay, token, invite, join and forget."""
import argparse
import hashlib
import json
import os
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

from . import NAME, VERSION, cards, config, demo, doctor, hostinfo, ingest, join, ledgerwriter, osx, schema, server, startup, store, themes

ENTRY = Path(__file__).resolve().parents[2] / "bin" / "weatherdeck"
MAX_STDIN = 512 * 1024


def _common():
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument("--data", default=argparse.SUPPRESS, help="data directory (default: per-user data dir, or $WEATHERDECK_DATA)")
    p.add_argument("--config", default=argparse.SUPPRESS, help="config file (default: <data>/config.json, or $WEATHERDECK_CONFIG)")
    p.add_argument("--demo", action="store_true", default=argparse.SUPPRESS,
                   help="use the separate demo store (<data>/demo) fed by synthetic sources")
    return p


def build_parser():
    common = _common()
    ap = argparse.ArgumentParser(prog="weatherdeck", description=f"{NAME} {VERSION}: an at-a-glance status board.", parents=[common])
    sub = ap.add_subparsers(dest="cmd", required=True)

    def serving(name, help_):
        p = sub.add_parser(name, help=help_, parents=[common])
        p.add_argument("--port", type=int, help="listen port (default from config, 8787)")
        p.add_argument("--bind", action="append", help="address to listen on: localhost, an IP, or auto:<cidr> (repeatable)")
        p.add_argument("--scenario", choices=sorted(demo.scenarios()), help="with --demo: a named variant of the demo (examples/demo/scenarios.json)")
        return p

    serving("run", "run in the foreground")
    serving("on", "start in the background")
    serving("restart", "stop, then start in the background")
    sub.add_parser("off", help="stop the background host", parents=[common])
    sub.add_parser("status", help="show whether it is running, where, and what is reporting", parents=[common])
    p = sub.add_parser("ingest", help="read one feed document on stdin (forced-command SSH or a local pipe)", parents=[common])
    p.add_argument("--source", help="only accept this source id")
    p = sub.add_parser("replay", help="push the synthetic demo sources to a running host over HTTP", parents=[common])
    p.add_argument("--url", default=None, help="host URL (default http://127.0.0.1:<port>)")
    p.add_argument("--token", default=os.environ.get("WEATHERDECK_TOKEN"), help="bearer token, if the host has tokens")
    p.add_argument("--interval", type=int, default=10)
    p.add_argument("--only", help="comma-separated source ids to replay (others stay absent)")
    p.add_argument("--silence", action="append", default=[], metavar="ID:SECONDS", help="make a source go silent after N seconds")
    p.add_argument("--scenario", choices=sorted(demo.scenarios()), help="replay a named variant of the demo (examples/demo/scenarios.json)")
    p = sub.add_parser("theme", help="list the page themes, or check one (schema, fonts, licences, contrast)", parents=[common])
    p.add_argument("action", choices=["list", "check"])
    p.add_argument("name", nargs="?", help="theme id (default: every theme)")
    p = sub.add_parser("token", help="manage per-source push tokens, or per-profile read tokens (--read)", parents=[common])
    p.add_argument("action", choices=["new", "list", "revoke"])
    p.add_argument("name", nargs="?", help="a source id, or with --read a profile name")
    p.add_argument("--read", action="store_true", help="the token protects viewing a profile instead of pushing a source")
    p = sub.add_parser("invite", help="add a machine: mint a push token for its source and print one join string for it (host side)",
                       parents=[common], description="Mint a push token for a new source, record the invite in <data>/invites.json and "
                       "print one join string (address, source id, machine id, expiry, token). The host refuses the token once the "
                       "invite expires before a first push from that source is accepted. See docs/onboarding.md.")
    p.add_argument("--machine", required=True, help="the new machine's id: 1-48 characters from a-z 0-9 . _ -")
    p.add_argument("--source", help="the source id it pushes as (default beat-<machine>)")
    p.add_argument("--ttl", default=join.TTL_DEFAULT, help="how long the invite stays open for a first push, e.g. 15m, 2h, 1d (default 15m)")
    p.add_argument("--url", help="the address the new machine reaches this host at (default: the first non-loopback address it listens on)")
    p = sub.add_parser("join", help="on a new machine: check everything a join needs (--dry-run), writing nothing",
                       description="Read a join string from 'weatherdeck invite' and run the preflight: Python, a real interpreter "
                       "(not the Microsoft Store alias), a service manager, write access, earlier installs, the host's address and "
                       "name, its clock, the token (a probe that stores nothing) and the source and machine ids; on Linux "
                       "also whether lingering is on, which a systemd user unit needs to survive the last logout. Each failure is "
                       "named with one next step. This version runs the preflight only. See docs/onboarding.md.")
    p.add_argument("string", nargs="?", help="the join string; leave it out (or give -) to paste it at a hidden prompt, which keeps "
                   "the token out of the process list and shell history")
    p.add_argument("--dry-run", action="store_true", help="run the preflight only and write nothing (required in this version)")
    p.add_argument("--python", help="the interpreter the service would run (default: this one); on Windows a real pythonw.exe")
    p.add_argument("--timeout", type=float, default=join.TIMEOUT_S, help="seconds to wait for the host (default 5)")
    p.add_argument("--scheduler", choices=join.SCHEDULERS, default="systemd",
                   help="Linux: how the beat would be registered: a systemd user unit (default; needs lingering on, or it stops when the "
                        "last login session ends), a crontab line, or a system-level unit")
    p = sub.add_parser("privacy", help="privacy mode: views marked `privacy` (the TV view) show counts only while it is on", parents=[common])
    p.add_argument("state", nargs="?", choices=["on", "off", "status"], default="status")
    p = sub.add_parser("startup", help="start the host at logon (Windows, no admin) and print the forced-command line for a pushing machine", parents=[common])
    p.add_argument("action", choices=["install", "remove", "status", "authorized-key"])
    p.add_argument("--config-from", help="install: copy this config file into place if there is none (an existing, different one is kept)")
    p.add_argument("--mode", choices=["auto", "task", "folder"], default="auto", help="install: a per-user logon task, the Startup folder, or try the task first (default)")
    p.add_argument("--no-start", action="store_true", help="install: do not start the host now")
    p.add_argument("--dry-run", action="store_true", help="install, remove: print what would be done and change nothing")
    p.add_argument("--for-windows", action="store_true", help="preview the Windows result on another system (with --dry-run, or authorized-key)")
    p.add_argument("--source", help="authorized-key: the source id this key may push for")
    p.add_argument("--key", help="authorized-key: the pushing machine's ssh-ed25519 public key line")
    p = sub.add_parser("card", help="add-in cards: validate a card, add one to the drop directory, or list what the board would show", parents=[common])
    p.add_argument("action", choices=["validate", "add", "list"])
    p.add_argument("target", nargs="?", help="validate: a card file, a directory of them, or - for stdin; add: a card file or -")
    p.add_argument("--json", action="store_true", help="validate, list: machine-readable output")
    p = sub.add_parser("ledger", help="write the host's own value ledger (closed UTC days not written yet), or show what it would write", parents=[common])
    p.add_argument("action", choices=["write"])
    p.add_argument("--dry-run", action="store_true", help="print the lines instead of appending them")
    p = sub.add_parser("doctor", help="read-only: is this machine's joined source delivering, and why not; --host: what on this host keeps a source off the board", parents=[common])
    p.add_argument("--host", action="store_true", help="check this host instead: invited sources never seen, refused pushes, push tokens, loopback pushers")
    p.add_argument("--join-config", help="the join config to read (default: the per-user one `weatherdeck join` writes)")
    p.add_argument("--url", help="the host URL (for a beat set up by hand, or to override the join config)")
    p.add_argument("--source", help="the source id (for a beat set up by hand, or to override the join config)")
    p.add_argument("--token-file", help="the push token file to check (its content is never shown)")
    p.add_argument("--read-token-file", help="a read token for the host's view, when the view needs one")
    p.add_argument("--pusher-state", help="an adapter pusher's state file to read its last push per sink from (default: the join config's `state_file`)")
    p = sub.add_parser("forget", help="remove a source and its stored feed", parents=[common])
    p.add_argument("source")
    p = sub.add_parser("logs", help="show the end of the server log", parents=[common])
    p.add_argument("-n", type=int, default=40)
    p = sub.add_parser("received", help="the received log: one line per push from any source, what it counted, and with --diff what changed", parents=[common])
    p.add_argument("--tail", type=int, default=20, help="the last N pushes (default 20)")
    p.add_argument("--diff", action="store_true", help="under each push, the titles that appeared, went or changed state")
    p.add_argument("--source", help="only this source")
    p.add_argument("--json", action="store_true", help="the raw JSON lines")
    p.add_argument("--summary", action="store_true", help="one line per source and day: pushes, rejections, longest gap, what it asked")
    return ap


# ---- process helpers ---------------------------------------------------------------------------
def _confirm(state):
    """Does the host this state file describes answer, and is it the same instance? None: no answer."""
    for url in state.get("urls") or []:
        try:
            with urllib.request.urlopen(url.rstrip("/") + "/healthz", timeout=2) as resp:
                return json.loads(resp.read().decode()).get("instance") == state.get("instance")
        except (OSError, ValueError):
            continue
    return None


def _running():
    """(pid, state, confirmed) of this data dir's host, or (None, None, None).

    The process table is never read: a pid counts as ours only when the host answers /healthz with
    this instance's id, so the same check works on Windows, macOS and Linux."""
    state = store.read_json(server.state_path())
    if not state or not osx.pid_alive(state.get("pid")):
        return None, None, None
    return state["pid"], state, _confirm(state)


def _passthrough(args):
    out = []
    if getattr(args, "port", None):
        out += ["--port", str(args.port)]
    for b in getattr(args, "bind", None) or []:
        out += ["--bind", b]
    if getattr(args, "scenario", None):
        out += ["--scenario", args.scenario]
    return out


_BASE = {"dir": None}


def _global_args():
    out = ["--data", str(_BASE["dir"]), "--config", str(config.config_path())]
    return out


# ---- commands ----------------------------------------------------------------------------------
def cmd_run(args):
    demo_mode = getattr(args, "demo", False)
    if demo_mode and config.data_dir().name == "demo":  # a fresh demo store every run
        shutil.rmtree(config.data_dir(), ignore_errors=True)
        config.data_dir()
    stop = threading.Event()

    def ready(host):
        if demo_mode:
            threading.Thread(target=demo.run, args=(demo.direct_push, 10), kwargs={"stop": stop, "scenario": getattr(args, "scenario", None), "cards_dir": cards.drop_dir()},
                             daemon=True).start()
            print("weatherdeck: demo mode: synthetic sources only; nothing here is real", flush=True)

    code = server.serve(port=args.port, bind=args.bind, on_ready=ready)
    stop.set()
    return code


def cmd_on(args):
    pid, state, ok = _running()
    if pid and ok is not False:
        print(f"already running (pid {pid}): " + ", ".join(state.get("urls") or []))
        return 0
    data = config.data_dir()
    out = open(data / "server.out", "ab")
    cmd = [sys.executable, str(ENTRY)] + _global_args() + (["--demo"] if getattr(args, "demo", False) else []) + ["run"] + _passthrough(args)
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT, **osx.background_kwargs())
    for _ in range(80):
        time.sleep(0.1)
        if proc.poll() is not None:
            break
        pid, state, _ = _running()
        if pid == proc.pid and state.get("urls"):
            print("running (pid %d): %s" % (pid, ", ".join(state["urls"])))
            return 0
    if proc.poll() is None and _running()[0] == proc.pid:
        print("running (pid %d), still waiting for a configured address; see 'weatherdeck logs'" % proc.pid)
        return 0
    print("failed to start; last lines of server.out:")
    out.close()
    for line in (data / "server.out").read_text(errors="replace").splitlines()[-10:]:
        print("  " + line)
    return 1


def cmd_off(args):
    pid, state, ok = _running()
    if not pid:
        print("not running")
        return 0
    if ok is None:
        print(f"pid {pid} is alive but does not answer; not touching it in case it is not ours. "
              f"If it is stuck, stop it by hand, then delete {server.state_path()}")
        return 1
    if ok is False:
        print("the state file is stale (that pid is another program now); removing it")
        server.state_path().unlink()
        return 0
    server.stop_path().write_text("stop\n")  # the host polls for this file
    for _ in range(80):
        time.sleep(0.1)
        if not osx.pid_alive(pid):
            print("stopped")
            return 0
    osx.force_stop(pid)
    print("did not stop in 8 s; terminated")
    return 0


def cmd_restart(args):
    cmd_off(args)
    return cmd_on(args)


def cmd_status(args):
    pid, state, ok = _running()
    print(f"{NAME} {VERSION}")
    print(f"data dir: {config.data_dir()}")
    if pid:
        print(f"running: pid {pid}" + ("" if ok else " (not answering)") + ", " + ", ".join(state.get("urls") or ["no address yet"]))
        for addr, prof in (state.get("listeners") or {}).items():
            print(f"  {addr}: serves {prof if isinstance(prof, str) else ', '.join(prof)}")
    else:
        print("not running (start it with: weatherdeck on)")
    conn = store.connect()
    rows = conn.execute("SELECT * FROM sources ORDER BY id").fetchall()
    if rows:
        print("sources:")
        now = time.time()
        for r in rows:
            age = now - (r["last_received"] or now)
            print(f"  {r['id']:<24} machine={r['machine'] or '-':<14} last report {int(age)} s ago, every {r['interval_s']} s")
    else:
        print("sources: none have reported yet")
    return 0


def cmd_ingest(args):
    if os.environ.get("SSH_ORIGINAL_COMMAND", "").strip() == "weatherdeck-check":
        # A health probe through a forced-command key: proves sshd, the key, this program and its data
        # directory all work, reads nothing from stdin and changes nothing.
        store.connect().close()
        print(f"ok {NAME} {VERSION} ready" + (f" source={args.source}" if args.source else ""))
        return 0
    config.setup_logging("ingest")
    raw = sys.stdin.buffer.read(MAX_STDIN + 1)
    if len(raw) > MAX_STDIN:
        print("rejected: payload larger than 512 KiB")
        return ingest.REJECTED
    res = ingest.ingest(raw, transport="stdin", pin_source=args.source)
    print(res.text)
    return res.code


def cmd_replay(args):
    cfg = config.get()
    url = args.url or f"http://127.0.0.1:{cfg['hosts']['port']}"
    silence = {}
    for s in args.silence:
        sid, _, secs = s.partition(":")
        silence[sid] = float(secs)
    stop = threading.Event()
    for sig in osx.termination_signals():
        try:
            signal.signal(sig, lambda *_: stop.set())
        except (ValueError, OSError):
            pass
    print(f"replaying synthetic sources to {url} every {args.interval} s (Ctrl-C to stop)")
    demo.run(demo.http_push(url, args.token), args.interval, set(args.only.split(",")) if args.only else None, silence, stop,
             log=lambda m: print(m, flush=True), scenario=args.scenario)
    return 0


def cmd_theme(args):
    if args.action == "list":
        for n in themes.names():
            print(n + ("  (configured)" if n == (config.get()["theme"].get("name") or "default") else ""))
        return 0
    ok = True
    for n in [args.name] if args.name else themes.names():
        lines, good = themes.check(n)
        print(f"{n}: {'ok' if good else 'FAILED'}")
        for line in lines:
            print("  " + line)
        ok &= good
    return 0 if ok else 1


def cmd_token(args):
    path = server.tokens_path()
    doc = store.read_json(path, {}) or {}
    bucket = "read" if args.read else "tokens"
    tokens = doc.setdefault(bucket, {})
    if args.action == "list":
        for name in sorted(tokens):
            print(name)
        return 0
    if args.read:
        if args.name not in config.get()["profiles"]:
            print("give a profile name: " + ", ".join(config.get()["profiles"]))
            return 2
    elif not args.name or not schema.ID_RE.match(args.name):
        print("give a source id: 1-48 characters from a-z 0-9 . _ -")
        return 2
    if args.action == "revoke":
        tokens.pop(args.name, None)
        store.write_json_atomic(path, doc)
        if not args.read:
            join.forget_invite(args.name)
        print(f"revoked {args.name}")
        return 0
    first_push_token = not args.read and not tokens
    token = secrets.token_urlsafe(32)
    tokens[args.name] = hashlib.sha256(token.encode()).hexdigest()
    store.write_json_atomic(path, doc)
    if not args.read:
        join.forget_invite(args.name)
    what = f"read token for profile {args.name}" if args.read else f"token for source {args.name}"
    print(f"{what} (shown once; the host keeps only its hash):\n{token}")
    if args.read:
        print("open the view once as <url>?key=<token>; the browser remembers it.")
    if first_push_token:
        print(first_token_note())
    return 0


def first_token_note():
    """What the first push token breaks (also said by `weatherdeck invite`)."""
    seen = ingest.loopback_http_sources()
    return ("this is the first push token: from now on loopback pushers without a token are refused too (they were accepted while no token existed).\n"
            + ("loopback HTTP sources seen in the received log in the last day, which will be refused until they send a token: " + ", ".join(seen)
               if seen else "no loopback HTTP source was seen in the received log in the last day."))


def cmd_privacy(args):
    path = server.privacy_path()
    if args.state == "on":
        config.data_dir()
        path.write_text(time.strftime("privacy mode on since %Y-%m-%dT%H:%M:%SZ\n", time.gmtime()))
    elif args.state == "off":
        try:
            path.unlink()
        except FileNotFoundError:
            pass
    follows = sorted(n for n, p in config.get()["profiles"].items() if p.get("privacy"))
    print("privacy mode: " + ("on" if server.privacy_on() else "off"))
    print("views that follow it: " + (", ".join(follows) if follows else "none (set \"privacy\": true on a profile)"))
    return 0


def cmd_startup(args):
    if args.action == "authorized-key" and not (args.source and args.key):
        print("authorized-key needs --source ID and --key \"ssh-ed25519 AAAA...\"")
        return 2
    return {"install": startup.cmd_install, "remove": startup.cmd_remove, "status": startup.cmd_status,
            "authorized-key": startup.cmd_authorized_key}[args.action](args)


def _read_card_arg(target):
    """-> (name, text) of a card given as a file or - for stdin."""
    if target == "-":
        return "stdin", sys.stdin.buffer.read(cards.MAX_BYTES + 1).decode("utf-8", "replace")
    try:
        with open(target, "rb") as fh:
            return target, fh.read(cards.MAX_BYTES + 1).decode("utf-8", "replace")
    except OSError as exc:
        raise SystemExit(f"weatherdeck: cannot read {target}: {exc.strerror or exc}")


def _parse_card(name, text):
    if len(text.encode("utf-8", "replace")) > cards.MAX_BYTES:
        return None, f"larger than {cards.MAX_BYTES // 1024} KiB"
    try:
        doc = json.loads(text)
    except ValueError as exc:
        return None, f"not valid JSON: {exc}"
    try:
        return cards.validate(doc), None
    except cards.Invalid as exc:
        return None, str(exc)


def cmd_card(args):
    if args.action == "list":
        return _card_list(args)
    if not args.target:
        print(f"weatherdeck card {args.action}: give a card file" + (", a directory or -" if args.action == "validate" else " or -"), file=sys.stderr)
        return 2
    if args.action == "add":
        name, text = _read_card_arg(args.target)
        card, why = _parse_card(name, text)
        if why:
            print(f"rejected {name}: {why}")
            return 1
        cards.put(cards.drop_dir(), card)
        print(f"added {card['tool']} ({card['status']}) to {cards.drop_dir()}")
        return 0
    results = []  # [(name, card or None, reason or None)]
    if args.target != "-" and os.path.isdir(args.target):
        for n in sorted(x for x in os.listdir(args.target) if x.endswith(".json") and not x.startswith(".")):
            card, why = cards.parse_file(os.path.join(args.target, n))
            results.append((n, card, why))
        if not results:
            print(f"no *.json files in {args.target}")
            return 1
    else:
        name, text = _read_card_arg(args.target)
        card, why = _parse_card(name, text)
        results.append((name, card, why))
    if args.json:
        print(json.dumps([{"file": n, "valid": why is None, "tool": (c or {}).get("tool"), "reason": why} for n, c, why in results], indent=1))
    else:
        for n, c, why in results:
            print(f"ok       {n}: {c['tool']} {c['status']}, {c['headline']}" if not why else f"INVALID  {n}: {why}")
    return 0 if all(why is None for _, _, why in results) else 1


def _card_list(args):
    now = time.time()
    directory = cards.drop_dir()
    shown, rejected = cards.load_dir(directory, now, log_rejects=False)
    rows = []
    for c in shown:
        age = now - schema.parse_time(c["updated_at"])
        rows.append(dict(c, age_s=int(age), stale=age > cards.stale_after(c)))
    if args.json:
        print(json.dumps({"dir": directory, "cards": rows, "rejected": [{"file": n, "reason": r} for n, r in rejected]}, indent=1))
        return 0
    print(f"card directory: {directory}")
    if not rows and not rejected:
        print("no cards (a tool with no card is simply not shown)")
    for c in rows:
        print(f"  {c['tool']:<24} {c['status']:<8} {'STALE ' if c['stale'] else ''}{c['age_s']} s old" + (f"  [{c['mode']}]" if c.get("mode") else "") + f"  {c['headline']}")
    for n, r in rejected:
        print(f"  rejected {n}: {r}")
    return 0


def cmd_ledger(args):
    conn = store.connect()
    try:
        res = ledgerwriter.run(conn, time.time(), dry_run=args.dry_run)
    finally:
        conn.close()
    for rec in res.pop("preview", None) or []:
        print(json.dumps(rec, separators=(",", ":")))
    print("ledger %s: %d lines for %d days%s" % (res["state"], res["lines"], res["days"], " (" + res["why"] + ")" if res["why"] else ""))
    return 1 if res["state"] == "refused" else 0


def cmd_doctor(args):
    return doctor.run(args)


def cmd_forget(args):
    conn = store.connect()
    store.forget_source(conn, args.source)
    print(f"forgot {args.source}")
    return 0


def cmd_logs(args):
    path = config.data_dir() / "server.log"
    if not path.exists():
        print("no server log yet")
        return 0
    print("\n".join(path.read_text(errors="replace").splitlines()[-args.n:]))
    return 0


def _received_lines(args):
    path = ingest.received_log_path()
    keep = max(1, int(config.get()["history"].get("received_log_keep", 3)))
    out = []
    for p in [path.with_name(f"{path.name}.{i}") for i in range(keep, 0, -1)] + [path]:
        try:
            with open(p, encoding="utf-8", errors="replace") as fh:
                for raw in fh:
                    try:
                        d = json.loads(raw)
                    except ValueError:
                        continue
                    if isinstance(d, dict) and (not args.source or d.get("source") == args.source):
                        out.append(d)
        except OSError:
            continue
    return out


def _received_row(d):
    when = (d.get("at") or "?").replace("T", " ").rstrip("Z")
    head = f"{when}  {d.get('source')} #{d.get('seq')} {d.get('result')} via {d.get('transport') or '?'} {d.get('bytes')} B"
    if d.get("result") != "ok":
        return f"{head} | {d.get('reason')}"
    c = d.get("counts") or {}
    extra = (f" · gap {d['gap']}" if d.get("gap") else "") + (" · restarted" if d.get("restarted") else "")
    return (f"{head} | wait {c.get('wait_on_you')} · items {c.get('items')} (running {c.get('running')}, waiting {c.get('waiting')}, "
            f"failed {c.get('failed')}) · next {c.get('next')} · done {c.get('done')}" + (f" · critical {c['critical']}" if c.get("critical") else "")
            + extra + (" | titles changed" if d.get("shown") else ""))


def _received_diff(old, new):
    rows = []
    for sec in ("wait_on_you", "critical", "items", "next", "done", "info"):
        a, b = old.get(sec) or [], new.get(sec) or []
        if sec == "items":
            sa, sb = {t: s for t, s in a}, {t: s for t, s in b}
            rows += [f"  + item: {t} [{sb[t]}]" for t in sb if t not in sa]
            rows += [f"  - item: {t} [{sa[t]}]" for t in sa if t not in sb]
            rows += [f"  ~ item: {t} [{sa[t]} -> {sb[t]}]" for t in sb if t in sa and sa[t] != sb[t]]
        else:
            rows += [f"  + {sec}: {t}" for t in b if t not in a]
            rows += [f"  - {sec}: {t}" for t in a if t not in b]
    return rows


def cmd_received(args):
    lines = _received_lines(args)
    if not lines:
        print(f"nothing received yet ({ingest.received_log_path()})")
        return 0
    if args.summary:
        groups = {}
        for d in lines:
            groups.setdefault((d.get("source"), (d.get("at") or "?")[:10]), []).append(d)
        for (sid, day), ls in sorted(groups.items()):
            ok = [d for d in ls if d.get("result") == "ok"]
            times = sorted(schema.parse_time(d["at"]) for d in ok if d.get("at"))
            gap = max((b - a for a, b in zip(times, times[1:])), default=0)
            calls = []
            for d in ok:
                for t in (d.get("shown") or {}).get("wait_on_you") or []:
                    if t not in calls:
                        calls.append(t)
            waits = [(d.get("counts") or {}).get("wait_on_you") for d in ok]
            print(f"{day} {sid}: {len(ls)} pushes, {len(ls) - len(ok)} rejected, longest gap {int(gap)} s, "
                  f"wait on you {min(waits) if waits else '?'}..{max(waits) if waits else '?'}, {len(calls)} distinct calls"
                  + (": " + "; ".join(calls[:6]) + (" ..." if len(calls) > 6 else "") if calls else ""))
        return 0
    window = lines[-max(1, args.tail):]
    if args.json:
        for d in window:
            print(json.dumps(d, separators=(",", ":"), ensure_ascii=False))
        return 0
    prev = {}
    for d in lines[:len(lines) - len(window)]:
        if d.get("shown"):
            prev[d.get("source")] = d["shown"]
    for d in window:
        print(_received_row(d))
        if d.get("shown"):
            if args.diff:
                base = prev.get(d.get("source"))
                print("  (first titles from this source in the log)" if base is None else "\n".join(_received_diff(base, d["shown"])) or "  (same titles, other order)")
            prev[d.get("source")] = d["shown"]
    return 0


def main(argv=None):
    args = build_parser().parse_args(argv)
    os.umask(0o077)  # everything written under the data dir is private to this user
    if args.cmd == "join":  # runs on the machine that joins: no host data dir, no host config, nothing written
        return join.cmd_join(args)
    base = config.init(getattr(args, "data", None), getattr(args, "config", None))
    _BASE["dir"] = base
    if getattr(args, "demo", False):
        hostinfo.DEMO = True
        config.init(str(base / "demo"), str(config.config_path()))
    try:
        cfg = config.get()
    except Exception as exc:
        print(f"weatherdeck: cannot read the config: {exc}", file=sys.stderr)
        return 2
    if hasattr(args, "port"):
        port, source = (args.port, "--port") if args.port is not None else (cfg["hosts"]["port"], "hosts.port in the config")
        if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
            print(f"weatherdeck: {source} must be a whole number from 1 to 65535 (got {port}).", file=sys.stderr)
            return 2
    from .hostinfo import BindError
    try:
        return _dispatch(args)
    except BindError as exc:
        print(f"weatherdeck: {exc}", file=sys.stderr)
        return 2


def _dispatch(args):
    return {"run": cmd_run, "on": cmd_on, "off": cmd_off, "restart": cmd_restart, "status": cmd_status,
            "ingest": cmd_ingest, "replay": cmd_replay, "theme": cmd_theme, "token": cmd_token, "privacy": cmd_privacy, "card": cmd_card, "ledger": cmd_ledger, "startup": cmd_startup, "doctor": cmd_doctor, "forget": cmd_forget, "logs": cmd_logs, "received": cmd_received,
            "invite": join.cmd_invite}[args.cmd](args)
