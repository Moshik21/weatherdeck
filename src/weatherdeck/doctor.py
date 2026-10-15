"""`weatherdeck doctor`: is this machine's source delivering, and if not, why; `doctor --host`: what on this host
keeps a source off the board.

Read-only, both sides. The machine side reads its join config, its service definition (`systemctl --user show`,
`launchctl print`, `schtasks /query`: queries only), its token file's metadata (never printing the token), the beat
file and the pusher's state file, and asks the host `GET /healthz`, `GET /api/view` and `GET /api/log`. It never
pushes. The host side reads files in its data directory and creates nothing there.

Each check is one line: `ok`, `warn`, `FAIL` with a named reason and one next step, or `not checked: <why>` when it
cannot be made; a check that cannot be made is never `ok`. "Live" is decided by the host having accepted a push from
this source within three intervals, by the host's own clock, never by a process existing.

Everything the machine side learns from the OS and the network goes through `Facts`, so a test can inject the
platform's answers (a Windows task, a Store-alias interpreter) on any system.
"""
import calendar
import ipaddress
import json
import os
import plistlib
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import VERSION, config, join, server

OK, WARN, FAIL, SKIP = "ok", "warn", "FAIL", "not checked"
SKEW_WARN_S = 120     # the same line the board draws (web/decks.js); the host judges staleness on its own clock anyway
INTERVALS = 3         # live: the host accepted a push within this many of the source's intervals
BEAT_INTERVAL_S = 15  # bin/weatherdeck-beat's default, when the join config does not say
DAY_S = 86400
LOG_TAIL = 200
# Slice 1's log line for a refused push (server.Handler._refuse): "<asctime> WARNING weatherdeck.server: refused POST
# /api/ingest from <address>: <why>"
REFUSED_RE = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\S* WARNING weatherdeck\.server: refused POST /api/ingest from (\S+): (.*)$")


class Check:
    def __init__(self, name, verdict, text, reason=None, next_step=None):
        self.name, self.verdict, self.text, self.reason, self.next_step = name, verdict, text, reason, next_step

    def line(self):
        body = f"{self.reason}: {self.text}" if self.reason else self.text
        if self.verdict == SKIP:
            body = f"not checked: {self.text}"
        return f"{self.verdict if self.verdict != SKIP else '--':<5} {self.name}: {body}" + (f"; next: {self.next_step}" if self.next_step else "")


def ok(name, text):
    return Check(name, OK, text)


def skip(name, why):
    return Check(name, SKIP, why)


def fail(name, reason, text, next_step):
    return Check(name, FAIL, text, reason, next_step)


def warn(name, reason, text, next_step):
    return Check(name, WARN, text, reason, next_step)


def ago(seconds):
    s = max(0, int(seconds))
    if s < 120:
        return f"{s} s"
    if s < 7200:
        return f"{s // 60} min"
    if s < 2 * DAY_S:
        return f"{s // 3600} h"
    return f"{s // DAY_S} days"


def _clock(epoch):
    return time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(epoch))


# ---- what the machine side learns from the OS and the network -------------------------------------
class Facts:
    """The real machine. A test subclasses this with fixed answers; doctor never writes through it."""

    def __init__(self):
        self.os = "darwin" if sys.platform == "darwin" else "windows" if os.name == "nt" else "linux"

    def now(self):
        return time.time()

    def home(self):
        return Path.home()

    def env(self, name):
        return os.environ.get(name)

    def uid(self):
        return os.getuid() if hasattr(os, "getuid") else None

    def user(self):
        return join.user_name(self.env)

    def wsl(self):
        return self.os == "linux" and join.is_wsl()

    def run(self, argv):
        """(exit code, output) of a query command; 127 when it is not there."""
        try:
            res = subprocess.run(argv, capture_output=True, text=True, timeout=10, errors="replace")
            return res.returncode, (res.stdout + res.stderr).strip()
        except FileNotFoundError:
            return 127, f"{argv[0]}: not found"
        except (OSError, subprocess.SubprocessError) as exc:
            return 126, str(exc)

    def stat(self, path):
        try:
            return os.stat(path)
        except (OSError, ValueError):
            return None

    def read(self, path, limit=1 << 20):
        try:
            with open(path, "rb") as fh:
                return fh.read(limit)
        except (OSError, ValueError):
            return None

    def get(self, url, token=None, timeout=5):
        """-> (status, body bytes, None) for any HTTP answer, or (None, b"", (kind, text)) when none came:
        kind is dns, refused, timeout or error."""
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"} if token else {})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read(4 << 20), None
        except urllib.error.HTTPError as exc:
            body = exc.read(4096)
            exc.close()
            return exc.code, body, None
        except urllib.error.URLError as exc:
            return (None, b"", _net_error(exc.reason))
        except (OSError, ValueError) as exc:
            return (None, b"", _net_error(exc))


def _net_error(exc):
    if isinstance(exc, socket.gaierror):
        return "dns", str(exc)
    if isinstance(exc, ConnectionRefusedError):
        return "refused", str(exc)
    if isinstance(exc, (socket.timeout, TimeoutError)):
        return "timeout", str(exc) or "timed out"
    return "error", str(exc)


# ---- where a joined machine keeps things (design C3; `join` writes these) -----------------------------
def join_config_path(facts):
    home = facts.home()
    if facts.os == "windows":
        return Path(facts.env("USERPROFILE") or home) / ".weatherdeck" / "join.json"
    if facts.os == "darwin":
        return home / "Library" / "Application Support" / "weatherdeck" / "join.json"
    return Path(facts.env("XDG_CONFIG_HOME") or home / ".config") / "weatherdeck" / "join.json"


def service_name(os_name, source):
    """The service `join` registers for a source: a LaunchAgent label, a systemd user unit, a Task Scheduler task."""
    return {"darwin": f"local.weatherdeck-beat.{source}", "windows": f"weatherdeck-beat-{source}"}.get(
        os_name, f"weatherdeck-beat-{source}.service")


def beat_file_paths(facts):
    """Where the beat file is, most likely first: on Windows the join's state folder (which the Store-Python redirect
    of %LOCALAPPDATA% cannot hide), then bin/weatherdeck-beat's default --out on this OS."""
    home = facts.home()
    if facts.os == "windows":
        return [Path(facts.env("USERPROFILE") or home) / ".weatherdeck" / "state" / "beat.json",
                Path(facts.env("LOCALAPPDATA") or home) / "weatherdeck-beat" / "beat.json"]
    if facts.os == "darwin":
        return [home / "Library" / "Caches" / "weatherdeck-beat" / "beat.json"]
    return [Path(facts.env("XDG_CACHE_HOME") or home / ".cache") / "weatherdeck-beat" / "beat.json"]


def _pick(doc, *keys):
    for k in keys:
        v = doc.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def _json_of(raw):
    try:
        doc = json.loads(raw.decode("utf-8")) if raw is not None else None
    except (ValueError, UnicodeDecodeError):
        return None
    return doc if isinstance(doc, dict) else None


def load_target(facts, join_config=None, url=None, source=None, token_file=None, pusher_state=None):
    """(target dict, the config check). The join config is read when there is one; --url, --source, --token-file and
    --pusher-state stand in for it (or override it), so a beat or an adapter set up by hand can be checked the same way."""
    path = Path(join_config).expanduser() if join_config else join_config_path(facts)
    raw = facts.read(path)
    doc = _json_of(raw) if raw is not None else None
    t = {"url": None, "source": None, "token_file": None, "interval_s": BEAT_INTERVAL_S, "service": None, "beat_file": None,
         "state_file": None, "config": path}
    if doc:
        t.update(url=_pick(doc, "url", "host_url", "host"), source=_pick(doc, "source", "source_id"),
                 token_file=_pick(doc, "token_file"), service=_pick(doc, "service"),
                 beat_file=_pick(doc, "beat_file", "out"), state_file=_pick(doc, "state_file"))
        every = doc.get("interval_s", doc.get("every"))
        if isinstance(every, (int, float)) and not isinstance(every, bool) and every > 0:
            t["interval_s"] = every
    t.update({k: v for k, v in (("url", url), ("source", source), ("token_file", token_file), ("state_file", pusher_state)) if v})
    name = "join config"
    if raw is not None and doc is None:
        check = fail(name, "CONFIG_UNREADABLE", f"{path} is not a JSON object", "run `weatherdeck join` again, or pass --url and --source")
    elif doc is None and not (url and source):
        check = fail(name, "NOT_JOINED", f"no join config at {path}",
                     "run `weatherdeck join <join-string>`, or for a beat set up by hand pass --url URL --source ID [--token-file F]")
    elif not (t["url"] and t["source"]):
        check = fail(name, "CONFIG_INCOMPLETE", f"{path} names no " + ("host URL" if not t["url"] else "source id"),
                     "run `weatherdeck join` again, or pass --url and --source")
    else:
        check = ok(name, (str(path) if doc else "none; from the command line") + f": source {t['source']} -> {t['url']}")
    if t["url"]:
        t["url"] = t["url"].rstrip("/")
    return t, check


# ---- the service and its interpreter ---------------------------------------------------------------
def _first_token(line):
    line = line.strip()
    if line.startswith('"'):
        end = line.find('"', 1)
        return line[1:end] if end > 0 else line[1:]
    return line.split()[0] if line.split() else ""


def _wrapper_interpreter(text):
    """The program a .cmd wrapper starts: the first token of its first line that is not @echo, rem, :: or blank."""
    for line in text.splitlines():
        s = line.strip()
        low = s.lower()
        if not s or low.startswith(("@", "rem ", "rem\t", "::")) or low == "rem":
            continue
        return _first_token(s)
    return None


def service_state(facts, name):
    """What the OS says about the service: {registered: True|False|None, running: True|False|None, program, why}.
    None is "could not tell"; `why` says why."""
    if facts.os == "linux":
        code, out = facts.run(["systemctl", "--user", "show", name, "--no-pager",
                               "--property=LoadState,ActiveState,SubState,ExecStart"])
        props = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
        if code != 0 or "LoadState" not in props:
            return {"registered": None, "running": None, "program": None,
                    "why": f"`systemctl --user` did not answer ({(out.splitlines() or [str(code)])[-1][:160]})"}
        m = re.search(r"argv\[\]=(\S+)", props.get("ExecStart", ""))
        return {"registered": props["LoadState"] == "loaded", "running": props.get("ActiveState") == "active",
                "program": m.group(1) if m else None, "why": f"{props.get('ActiveState')} ({props.get('SubState')})"}
    if facts.os == "darwin":
        plist = facts.home() / "Library" / "LaunchAgents" / f"{name}.plist"
        program = None
        raw = facts.read(plist)
        if raw is not None:
            try:
                doc = plistlib.loads(raw)
                program = (doc.get("ProgramArguments") or [None])[0] or doc.get("Program")
            except (ValueError, plistlib.InvalidFileException, AttributeError, IndexError):
                program = None
        code, out = facts.run(["launchctl", "print", f"gui/{facts.uid()}/{name}"])
        if code == 127:
            return {"registered": None, "running": None, "program": program, "why": "launchctl is not there"}
        loaded = code == 0
        m = re.search(r"^\s*state = (.+)$", out, re.M)
        if not program:
            pm = re.search(r"^\s*program = (.+)$", out, re.M)
            program = pm.group(1).strip() if pm else None
        if not loaded and raw is None:
            return {"registered": False, "running": False, "program": None, "why": "no LaunchAgent"}
        return {"registered": True, "running": loaded and bool(m) and m.group(1).strip() == "running", "program": program,
                "why": ("not loaded into launchd" if not loaded else f"state {m.group(1).strip() if m else 'unknown'}"), "loaded": loaded,
                "plist": plist}
    code, out = facts.run(["schtasks", "/query", "/tn", name, "/xml"])
    if code == 127:
        return {"registered": None, "running": None, "program": None, "why": "schtasks is not there"}
    if code != 0:
        return {"registered": False, "running": False, "program": None, "why": (out.splitlines() or [""])[-1][:160]}
    cmd = re.search(r"<Command>(.*?)</Command>", out, re.S)
    program = cmd.group(1).strip().strip('"') if cmd else None
    if program and program.lower().endswith((".cmd", ".bat")):
        raw = facts.read(program)
        program = _wrapper_interpreter(raw.decode("utf-8", "replace")) if raw is not None else None
    code, listing = facts.run(["schtasks", "/query", "/tn", name, "/fo", "list"])
    st = re.search(r"^Status:\s*(\S.*)$", listing, re.M) if code == 0 else None
    status = st.group(1).strip() if st else None
    return {"registered": True, "running": (status == "Running") if status else None, "program": program,
            "why": f"status {status}" if status else "its run state was not read (a Status line in English was not found)"}


def check_service(facts, t):
    name = t["service"] or service_name(facts.os, t["source"])
    st = service_state(facts, name)
    label = "service"
    if st["registered"] is None:
        return skip(label, f"{name}: {st['why']}"), st
    if not st["registered"]:
        how = {"linux": "systemd user unit", "darwin": "LaunchAgent", "windows": "logon task"}[facts.os]
        return fail(label, "SERVICE_NOT_REGISTERED", f"no {how} {name} ({st['why']})",
                    "run `weatherdeck join` again (it registers the service), or check the name in the join config"), st
    if st["running"] is None:
        return ok(label, f"{name} is registered; {st['why']}"), st
    if not st["running"]:
        step = {"linux": f"systemctl --user start {name}; then `journalctl --user -u {name}` says why it stopped",
                "darwin": f"launchctl bootstrap gui/{facts.uid()} {st.get('plist')}" if not st.get("loaded") else
                          f"launchctl kickstart gui/{facts.uid()}/{name}; its log says why it stopped",
                "windows": f'schtasks /run /tn "{name}"; the beat log says why it stopped'}[facts.os]
        return fail(label, "SERVICE_NOT_RUNNING", f"{name} is registered but not running ({st['why']})", step), st
    return ok(label, f"{name} is registered and running"), st


LINGER_NAME = "systemd user timers survive logout"
UNIT_NAME = re.compile(r"^(weatherdeck|lookout)-", re.I)
TIMER_ROW = re.compile(r"(\S+\.timer)\s+\S+\.service\s*$")  # list-timers ends each row with UNIT and ACTIVATES


def _next_elapse(facts, timer):
    code, out = facts.run(["systemctl", "--user", "show", timer, "--no-pager", "--property=NextElapseUSecRealtime"])
    m = re.search(r"^NextElapseUSecRealtime=(.*)$", out, re.M) if code == 0 else None
    when = m.group(1).strip() if m else ""
    return f"{timer} next elapses {when}" if when and when != "n/a" else f"{timer} reports no next elapse"


def check_linger(facts, t, st):
    """Does a systemd user unit or timer outlive the last login session? Only with lingering on: otherwise logind stops the
    user's manager at the last logout and takes the unit with it, and the machine is missing from the board until the next
    login. Advice only: never runs enable-linger. `st` is service_state() of the beat's unit, which says whether the user
    manager answers and whether the unit is there."""
    if facts.os != "linux":
        return skip(LINGER_NAME, "not applicable: " + {"darwin": "macOS runs the beat under launchd, which has no logout rule",
                                                     "windows": "Windows runs the beat as a logon task, which has no logout rule"}[facts.os])
    if facts.wsl():
        user = facts.user()
        linger = join.read_linger(facts.run, user) if user else {"state": None}
        found = {"yes": f"lingering is on for {user}", "no": f"lingering is off for {user}"}.get(linger["state"], "lingering could not be read")
        return skip(LINGER_NAME, f"not applicable under WSL: {found}, but the user manager's lifetime is bound to WSL itself, "
                                 "so lingering is not advice here")
    if st["registered"] is None:
        return skip(LINGER_NAME, f"not applicable, or not answering: no systemd user manager answered ({st['why']})")
    user = facts.user()
    if not user:
        return skip(LINGER_NAME, "this machine's user name could not be read")
    code, out = facts.run(["systemctl", "--user", "list-timers", "--all", "--no-legend", "--no-pager"])
    timers = sorted({m.group(1) for m in (TIMER_ROW.search(line) for line in out.splitlines()) if m and UNIT_NAME.match(m.group(1))}) if code == 0 else []
    units = ([t["service"] or service_name("linux", t["source"])] if st["registered"] else []) + timers
    linger = join.read_linger(facts.run, user)
    if not linger["state"]:
        return skip(LINGER_NAME, f"lingering for {user} could not be read ({linger['why']})")
    detail = "; ".join(_next_elapse(facts, x) for x in timers)
    if linger["state"] == "yes":
        return ok(LINGER_NAME, f"lingering is on for {user}, so the user manager and its units outlive the last login" + (f"; {detail}" if detail else ""))
    if not units:
        return ok(LINGER_NAME, f"lingering is off for {user}, but no Weatherdeck systemd user unit or timer is registered here, so a logout stops none")
    return warn(LINGER_NAME, "LINGER_OFF", f"lingering is off for {user}: {', '.join(units)} stops when the last login session ends and "
                f"returns only at the next login, so the board shows this machine missing in between" + (f"; {detail}" if detail else ""),
                f"loginctl enable-linger {user}   (advice only: doctor never runs it)")


def check_interpreter(facts, st):
    label = "interpreter"
    path = st.get("program") if st else None
    if not path:
        return skip(label, "the service's program could not be read" + (f" ({st['why']})" if st and st.get("why") else ""))
    if facts.os == "windows":
        norm = path.replace("/", "\\")
        if "\\windowsapps\\" in norm.lower():
            return fail(label, "STORE_ALIAS", f"the service runs {path}, the Microsoft Store alias; it runs but never delivers",
                        "install Python from python.org and run `weatherdeck join` again with that interpreter")
        if "\\" not in norm:
            return fail(label, "BARE_INTERPRETER", f"the service runs a bare {path!r}, found through PATH (which may be the Store alias)",
                        "run `weatherdeck join` again so the service names the real interpreter's full path")
    elif not path.startswith("/"):
        return fail(label, "BARE_INTERPRETER", f"the service runs a bare {path!r}, found through PATH",
                    "run `weatherdeck join` again so the service names the interpreter's full path")
    if facts.stat(path) is None:
        return fail(label, "INTERPRETER_MISSING", f"the service runs {path}, which is not there",
                    "run `weatherdeck join` again with an interpreter that exists")
    return ok(label, f"{path} (a real interpreter, not an alias)")


# ---- the token file --------------------------------------------------------------------------------
def check_token_file(facts, t):
    """(presence check, mode check). The token is read only to see that the file is not empty; it is never printed."""
    path = t["token_file"]
    if not path:
        return (skip("token file", "the join config names no token file (a host with no tokens takes loopback pushes without one)"),
                skip("token file mode", "no token file"))
    path = os.path.expanduser(path)
    st = facts.stat(path)
    if st is None:
        return (fail("token file", "TOKEN_FILE_MISSING", f"{path} is not there",
                     "make a new token on the host (`weatherdeck invite`, or `weatherdeck token new <source>`) and save it there"),
                skip("token file mode", "no token file"))
    raw = facts.read(path, 4096)
    if raw is None:
        presence = fail("token file", "TOKEN_FILE_UNREADABLE", f"{path} cannot be read by this user",
                        "the service runs as this user: give this user read access to it")
    elif not raw.strip():
        presence = fail("token file", "TOKEN_FILE_EMPTY", f"{path} is empty",
                        "make a new token on the host (`weatherdeck token new <source>`) and save it there")
    else:
        presence = ok("token file", f"{path} is there and not empty (its content is never shown)")
    if facts.os == "windows":
        mode = skip("token file mode", "Windows keeps access in an ACL, which this version does not read")
    elif st.st_mode & 0o077:
        mode = fail("token file mode", "TOKEN_FILE_OPEN", f"{path} has mode {st.st_mode & 0o777:04o}: other users can read it",
                    f"chmod 600 {path}")
    else:
        mode = ok("token file mode", f"{st.st_mode & 0o777:04o}, private to this user")
    return presence, mode


# ---- what the host says --------------------------------------------------------------------------
def check_host(facts, t):
    """(check, healthz doc or None, local clock at the answer or None)."""
    label = "host"
    t0 = facts.now()
    status, body, err = facts.get(t["url"] + "/healthz")
    t1 = facts.now()
    if err:
        kind, text = err
        return fail(label, f"HOST_UNREACHABLE ({kind})", f"{t['url']}: {text}",
                    "on the host, `weatherdeck status` lists the addresses it listens on; check the URL, the firewall and that the host runs"), None, None
    if status == 403:
        return fail(label, "HOST_NAME_REFUSED", f"{t['url']} refused this address as a Host name: {body.decode('utf-8', 'replace').strip()[:160]}",
                    "add the name to the host's `hosts.allowed_hosts`, or use an address it lists in `weatherdeck status`"), None, None
    doc = _json_of(body) if status == 200 else None
    if not doc or doc.get("ok") is not True:
        return fail(label, "HOST_NOT_WEATHERDECK", f"{t['url']}/healthz answered HTTP {status}, not a Weatherdeck host's health answer",
                    "check the URL and port in the join config"), None, None
    return ok(label, f"{t['url']} answers (Weatherdeck {doc.get('version') or 'version not said'})"), doc, (t0 + t1) / 2


def _read_token(path):
    try:
        with open(os.path.expanduser(path), encoding="utf-8") as fh:
            return fh.read(4096).strip() or None
    except OSError:
        return None


def check_received(facts, t, health, read_token=None):
    """The accepted-push proof: the host's own view of this source, aged on the host's own clock."""
    label = "host received"
    if not health:
        return skip(label, "the host did not answer")
    host_now = health.get("now")
    if not isinstance(host_now, (int, float)):
        return skip(label, "the host's /healthz did not say its time")
    status, body, err = facts.get(t["url"] + "/api/view", read_token)
    if err:
        return skip(label, f"/api/view did not answer ({err[0]}: {err[1]})")
    if status == 401:
        return skip(label, "the host's view needs a read token; pass --read-token-file with that view's read token")
    doc = _json_of(body) if status == 200 else None
    sources = ((doc or {}).get("view") or {}).get("sources")
    if not isinstance(sources, list):
        return skip(label, f"/api/view answered HTTP {status} with no source list (no view is served at the URL's root?)")
    src = next((s for s in sources if isinstance(s, dict) and s.get("id") == t["source"] and not s.get("placeholder")), None)
    status, body, err = facts.get(t["url"] + f"/api/log?n={LOG_TAIL}", read_token)
    lines = ((_json_of(body) or {}).get("lines") if status == 200 else None) or []
    mine = [d for d in lines if isinstance(d, dict) and d.get("source") == t["source"]]
    last_rej = next((d for d in reversed(mine) if d.get("result") == "rejected"), None)
    rej_at = _parse_iso(last_rej.get("at")) if last_rej else None
    got = src.get("received_at") if src else None
    if not isinstance(got, (int, float)):
        if last_rej:
            return fail(label, "REJECTED", f"the host has no accepted push from {t['source']}; it rejected one at "
                        f"{_clock(rej_at) if rej_at else '?'}: {last_rej.get('reason') or 'no reason given'}",
                        f"on the host, `weatherdeck received --source {t['source']}` shows each push and why")
        return fail(label, "NEVER_RECEIVED", f"the host has no accepted push from {t['source']}",
                    "the service and push state lines above say why; on the host, `weatherdeck doctor --host` lists refusals")
    every = src.get("interval_s") if isinstance(src.get("interval_s"), (int, float)) and src.get("interval_s") > 0 else t["interval_s"]
    age = host_now - got
    if rej_at and rej_at > got:
        return fail(label, "REJECTED", f"the host's last accepted push from {t['source']} was {ago(age)} ago; since then it rejected one: "
                    f"{last_rej.get('reason') or 'no reason given'}",
                    f"on the host, `weatherdeck received --source {t['source']}` shows each push and why")
    if age > INTERVALS * every:
        return fail(label, "SILENT", f"the host's last accepted push from {t['source']} was {ago(age)} ago by its own clock, "
                    f"more than {INTERVALS} intervals ({ago(INTERVALS * every)})",
                    "the service and push state lines above say why")
    return ok(label, f"the host accepted a push from {t['source']} {ago(age)} ago by its own clock (every {ago(every)})")


def _parse_iso(text):
    try:
        return calendar.timegm(time.strptime(text, "%Y-%m-%dT%H:%M:%SZ"))
    except (TypeError, ValueError):
        return None


def check_skew(health, local_at):
    label = "clock skew"
    if not health or local_at is None:
        return skip(label, "the host did not answer")
    host_now = health.get("now")
    if not isinstance(host_now, (int, float)):
        return skip(label, "the host's /healthz did not say its time")
    skew = local_at - host_now
    where = "ahead of" if skew > 0 else "behind"
    if abs(skew) > SKEW_WARN_S:
        return warn(label, "CLOCK_SKEW", f"this machine's clock is {ago(abs(skew))} {where} the host's",
                    "fix this machine's time sync (NTP); the host judges staleness on its own clock, so the board stays right")
    return ok(label, f"{abs(skew):.1f} s {where} the host's")


def check_version(health):
    label = "version"
    if not health:
        return skip(label, "the host did not answer")
    host = health.get("version")
    if not isinstance(host, str) or not host:
        return skip(label, "the host's /healthz did not say its version")
    host_v = host.split("-")[0]
    if host_v != VERSION:
        return warn(label, "VERSION_SKEW", f"the host runs Weatherdeck {host_v}, this machine {VERSION}",
                    "upgrade the older side (the host first when it is the older one)")
    here = server.package_version()
    there = (health.get("package") or {}).get("hash") if isinstance(health.get("package"), dict) else None
    if here and there and here["hash"] != there:
        return warn(label, "VERSION_SKEW", f"both run {VERSION}, but the package files differ (host {there}, here {here['hash']})",
                    "install the same build on both")
    return ok(label, f"{VERSION} on both" + ("" if there and here else " (package hashes not compared)"))


# ---- push state recorded on this machine ---------------------------------------------------------
PUSH_NEXT = {401: "the host does not hold this token: make a new one there (`weatherdeck token new <source>`) and save it in the token file",
             403: "the host refused the push (no tokens yet, or a Host or Origin refusal); its reason is above"}


def check_beat_push(facts, t):
    label = "push state (beat)"
    paths = [Path(os.path.expanduser(t["beat_file"]))] if t["beat_file"] else beat_file_paths(facts)
    path, doc = paths[0], None
    for p in paths:
        doc = _json_of(facts.read(p))
        if doc is not None:
            path = p
            break
    if doc is None:
        return None, path
    at = doc.get("at_epoch")
    every = doc.get("interval_s") if isinstance(doc.get("interval_s"), (int, float)) and doc.get("interval_s") > 0 else t["interval_s"]
    if isinstance(at, (int, float)) and facts.now() - at > INTERVALS * every:
        return fail(label, "BEAT_STALE", f"{path} was last written {ago(facts.now() - at)} ago: the beat is not sampling, so its push "
                    "state is old too", "the service line above says whether it runs"), path
    push = doc.get("push")
    if not isinstance(push, dict) or not isinstance(push.get("state"), str):
        version = ((doc.get("machine") or {}).get("beat") or {}).get("version") if isinstance(doc.get("machine"), dict) else None
        return skip(label, f"not recorded by this version of the beat ({version or 'version not said'}; beat 1.2 records it in {path})"), path
    since = f" since {push['since']}" if isinstance(push.get("since"), str) else ""
    reason = push.get("reason") if isinstance(push.get("reason"), str) else "no reason recorded"
    if push["state"] == "ok":
        return ok(label, f"the beat's last push was accepted{since}"), path
    if push["state"] == "refused":
        return fail(label, "PUSH_REFUSED", f"the host refused the beat's pushes{since}: {reason}",
                    PUSH_NEXT.get(push.get("code"), "the host's words above say why")), path
    return fail(label, "PUSH_DOWN", f"the beat's pushes are not getting through{since}: {reason}",
                "the host line above says whether the host answers this machine"), path


def check_pusher_push(facts, t):
    """An adapter's pusher that keeps per-sink state ({"source_id", "sinks": {name: {state, last}}}), named by the join
    config's `state_file` or --pusher-state; nothing is guessed when neither names one."""
    label = "push state (pusher)"
    if not t["state_file"]:
        return None, None
    path = Path(os.path.expanduser(t["state_file"]))
    doc = _json_of(facts.read(path))
    if doc is None:
        return skip(label, f"no pusher state at {path}"), path
    if doc.get("source_id") not in (None, t["source"]):
        return skip(label, f"{path} is for source {doc.get('source_id')!r}, not {t['source']}"), path
    sinks = {k: v for k, v in (doc.get("sinks") or {}).items() if isinstance(k, str) and isinstance(v, dict)} \
        if isinstance(doc.get("sinks"), dict) else {}
    if not sinks:
        return skip(label, f"not recorded: {path} holds no sink state yet"), path
    bad = [(n, s) for n, s in sorted(sinks.items()) if s.get("state") not in ("ok", "new")]
    fresh = [n for n, s in sorted(sinks.items()) if s.get("state") == "new"]
    if bad:
        name, s = bad[0]
        reason = {"refused": "PUSH_REFUSED", "rejected": "PUSH_REJECTED"}.get(s.get("state"), "PUSH_DOWN")
        last = s.get("last") if isinstance(s.get("last"), str) else "no reason recorded"
        more = f" (and {len(bad) - 1} more sink(s) not ok)" if len(bad) > 1 else ""
        return fail(label, reason, f"sink {name} is {s.get('state')}: {last}{more}",
                    "push once by hand with the adapter's own command; it prints the host's answer"), path
    if fresh and len(fresh) == len(sinks):
        return skip(label, f"no push recorded yet for sink(s) {', '.join(fresh)}"), path
    return ok(label, "every sink's last push was accepted: " + ", ".join(n for n in sorted(sinks) if n not in fresh)
              + (f" (not pushed yet: {', '.join(fresh)})" if fresh else "")), path


def machine_checks(facts, join_config=None, url=None, source=None, token_file=None, read_token_file=None, pusher_state=None):
    t, cfg = load_target(facts, join_config, url, source, token_file, pusher_state)
    checks = [cfg]
    if cfg.verdict == FAIL:
        for name in ("service", "interpreter", LINGER_NAME, "token file", "token file mode", "host", "host received", "push state",
                     "clock skew", "version"):
            checks.append(skip(name, "no source to check (the join config line above)"))
        return checks
    svc, st = check_service(facts, t)
    checks += [svc, check_interpreter(facts, st), check_linger(facts, t, st)]
    checks += list(check_token_file(facts, t))
    host, health, local_at = check_host(facts, t)
    read_token = _read_token(read_token_file) if read_token_file else None
    checks += [host, check_received(facts, t, health, read_token)]
    beat, beat_path = check_beat_push(facts, t)
    pusher, pusher_path = check_pusher_push(facts, t)
    pushes = [c for c in (beat, pusher) if c]
    checks += pushes or [skip("push state", f"no beat file at {beat_path}, and no pusher state file named (join config `state_file`, "
                                            "or --pusher-state)")]
    checks += [check_skew(health, local_at), check_version(health)]
    return checks


def machine_overall(checks):
    """(line, exit code). Exit 0 only when the host accepted a push within three intervals and nothing failed."""
    failed = [c for c in checks if c.verdict == FAIL]
    received = next((c for c in checks if c.name == "host received"), None)
    warned = [c.reason for c in checks if c.verdict == WARN]
    if received and received.verdict == OK and not failed:
        return "overall: live: " + received.text + (f" (warnings: {', '.join(warned)})" if warned else ""), 0
    if failed:
        first = failed[0]
        head = "delivering, but " if received and received.verdict == OK else "NOT live: "
        return f"overall: {head}{len(failed)} check(s) failed; first: {first.name} {first.reason}", 1
    return f"overall: not proven: {received.name if received else 'host received'} was not checked", 1


# ---- the host side ---------------------------------------------------------------------------------
def _host_files():
    d = config.data_path()
    return {"data": d, "tokens": d / "tokens.json", "invites": d / "invites.json", "sources": d / "sources", "rejected": d / "rejected",
            "server_log": d / "server.log", "received": d / "received-log.jsonl"}


def _read_json_file(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh), None
    except FileNotFoundError:
        return None, "absent"
    except (OSError, ValueError) as exc:
        return None, str(exc)


def accepted_sources(files):
    """source id -> the host's receive time of its last accepted push (from the stored feeds)."""
    out = {}
    try:
        paths = sorted(files["sources"].glob("*.json"))
    except OSError:
        return out
    for p in paths:
        doc, _ = _read_json_file(p)
        if isinstance(doc, dict) and isinstance(doc.get("received_at"), (int, float)):
            out[p.stem] = doc["received_at"]
    return out


def _epoch(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    return _parse_iso(v) if isinstance(v, str) else None


def read_invites(doc):
    """[{source, invited_at, expires_at, joined_at}] from the invite registry (`weatherdeck invite`'s
    {"version": 1, "invites": {<source>: {"created_at", "expires_at", "joined_at", ...}}}), read defensively: a list of
    records naming `source`, `source_id` or `id` is read too, epoch numbers or ISO times, and unknown fields are ignored."""
    body = doc.get("invites", doc) if isinstance(doc, dict) else doc
    rows = []
    items = body.items() if isinstance(body, dict) else ((None, r) for r in body) if isinstance(body, list) else []
    for key, rec in items:
        rec = rec if isinstance(rec, dict) else {}
        sid = _pick(rec, "source", "source_id", "id") or key
        if isinstance(sid, str) and sid:
            rows.append({"source": sid, "invited_at": _epoch(rec.get("invited_at", rec.get("created_at", rec.get("at")))),
                         "expires_at": _epoch(rec.get("expires_at", rec.get("expires"))), "joined_at": _epoch(rec.get("joined_at"))})
    return rows


def check_invites(files, seen, now):
    label = "invited sources"
    doc, err = _read_json_file(files["invites"])
    if err == "absent":
        return skip(label, f"no invite registry ({files['invites']})")
    if doc is None:
        return skip(label, f"the invite registry could not be read ({err})")
    rows = read_invites(doc)
    if not rows:
        return ok(label, "the invite registry lists no invite")
    unseen = [r for r in rows if r["source"] not in seen and not r["joined_at"]]
    open_ = [r for r in unseen if r["expires_at"] and r["expires_at"] > now]
    never = [r for r in unseen if r not in open_]
    waiting = (f"; still within the invite's time: {', '.join(r['source'] for r in open_)}" if open_ else "")
    if never:
        return fail(label, "INVITED_NEVER_SEEN", "invited and never reported: " + ", ".join(
            r["source"] + (f" (invited {_clock(r['invited_at'])}" + (", expired" if r["expires_at"] else "") + ")" if r["invited_at"] else "")
            for r in never) + waiting,
            "run `weatherdeck doctor` on that machine; it names what stops its pushes")
    return ok(label, f"{len(rows) - len(unseen)} of {len(rows)} invited source(s) have reported" + waiting)


def _log_refusals(files, now):
    """address -> (epoch, why) of the last refused push in server.log (and its one backup) within a day."""
    out = {}
    for p in (files["server_log"].with_name("server.log.1"), files["server_log"]):
        try:
            with open(p, encoding="utf-8", errors="replace") as fh:
                for raw in fh:
                    m = REFUSED_RE.match(raw.rstrip("\n"))
                    if not m:
                        continue
                    try:
                        at = time.mktime(time.strptime(m.group(1), "%Y-%m-%d %H:%M:%S"))  # the log's local time
                    except ValueError:
                        continue
                    if now - DAY_S <= at <= now + 60:
                        out[m.group(2)] = (at, m.group(3))
        except OSError:
            continue
    return out


def received_lines(files, now):
    keep = max(1, int(config.get()["history"].get("received_log_keep", 3)))
    path = files["received"]
    out = []
    for p in [path.with_name(f"{path.name}.{i}") for i in range(keep, 0, -1)] + [path]:
        try:
            with open(p, encoding="utf-8", errors="replace") as fh:
                for raw in fh:
                    try:
                        d = json.loads(raw)
                    except ValueError:
                        continue
                    at = _parse_iso(d.get("at")) if isinstance(d, dict) else None
                    if at is not None and now - DAY_S <= at <= now + 60:
                        out.append(dict(d, _at=at))
        except OSError:
            continue
    return out


def check_refusals(files, seen, lines, now):
    label = "refused pushes"
    found = []
    try:
        rejected = sorted(files["rejected"].glob("*.json"))
    except OSError:
        rejected = []
    for p in rejected:
        doc, _ = _read_json_file(p)
        at = _epoch((doc or {}).get("last_at")) if isinstance(doc, dict) else None
        if at is None or (p.stem in seen and seen[p.stem] >= at):
            continue
        found.append(f"{p.stem}: {doc.get('reason') or 'no reason recorded'} ({_clock(at)})")
    logged = _log_refusals(files, now)
    accepted_from = {}
    for d in lines:
        if d.get("result") == "ok" and isinstance(d.get("client"), str):
            accepted_from[d["client"]] = max(accepted_from.get(d["client"], 0), d["_at"])
    for addr, (at, why) in sorted(logged.items()):
        if accepted_from.get(addr, 0) < at:
            found.append(f"from {addr}: {why} ({_clock(at)})")
    if found:
        return fail(label, "REFUSED", "; ".join(found),
                    "run `weatherdeck doctor` on that machine; `weatherdeck received --source <id>` shows each push")
    if not hasattr(server, "note_refusal"):
        return skip(label, "this host version does not record a push refused for its token (401, 403); its rejected records show none")
    if not files["server_log"].exists():
        return skip(label, f"no server.log in {files['data']} (a refused push without a token is only in that log)")
    return ok(label, "no source or address whose last push was refused (rejected records, and server.log for the last day)")


def check_tokens(files, seen):
    label = "push tokens"
    doc, err = _read_json_file(files["tokens"])
    if err == "absent":
        return ok(label, "none (loopback pushers are accepted without one until the first exists)"), {}
    if not isinstance(doc, dict):
        return skip(label, f"tokens.json could not be read ({err or 'not an object'})"), None
    tokens = doc.get("tokens") if isinstance(doc.get("tokens"), dict) else {}
    if not tokens:
        return ok(label, "none (loopback pushers are accepted without one until the first exists)"), {}
    unused = sorted(t for t in tokens if t not in seen)
    names = ", ".join(sorted(tokens))
    if unused:
        return warn(label, "TOKEN_NEVER_USED", f"{len(tokens)}: {names}; never used for an accepted push: {', '.join(unused)}",
                    "run `weatherdeck doctor` on that machine, or `weatherdeck token revoke <id>` if it is gone"), tokens
    return ok(label, f"{len(tokens)}: {names}; each has an accepted push"), tokens


def _loopback(addr):
    try:
        return ipaddress.ip_address(addr).is_loopback
    except ValueError:
        return False


def check_loopback(lines, tokens):
    label = "loopback pushers"
    if tokens is None:
        return skip(label, "the tokens could not be read")
    http = [d for d in lines if d.get("transport") == "http"]
    if not http:
        return ok(label, "no HTTP push in the received log in the last day")
    if not any("client" in d for d in http):
        return skip(label, "the received log does not record pushers' addresses in this host version")
    loop = sorted({d["source"] for d in http if d.get("result") == "ok" and isinstance(d.get("source"), str)
                   and _loopback(d.get("client"))})
    if tokens:
        bare = [s for s in loop if s not in tokens]
        if bare:
            return fail(label, "LOOPBACK_REFUSED", f"{', '.join(bare)} pushed over loopback with no token of its own; this host has push "
                        "tokens, so it is refused now", f"`weatherdeck token new {bare[0]}`, and give that pusher the token (--token-file)")
        return ok(label, "every loopback HTTP source of the last day has a token of its own" if loop else "no loopback HTTP push in the last day")
    if loop:
        return warn(label, "LOOPBACK_AT_RISK", f"{', '.join(loop)} push over loopback without a token; the first push token "
                    "this host makes will have them refused", "when you make the first token, make one for each of these too")
    return ok(label, "no loopback HTTP push in the last day")


def host_checks(now=None):
    now = now if now is not None else time.time()
    files = _host_files()
    if not files["data"].is_dir():
        return [skip(n, f"no data directory at {files['data']}") for n in ("invited sources", "refused pushes", "push tokens", "loopback pushers")]
    seen = accepted_sources(files)
    lines = received_lines(files, now)
    tok, tokens = check_tokens(files, seen)
    return [check_invites(files, seen, now), check_refusals(files, seen, lines, now), tok, check_loopback(lines, tokens)]


def host_overall(checks):
    failed = [c for c in checks if c.verdict == FAIL]
    skipped = sum(1 for c in checks if c.verdict == SKIP)
    tail = f" ({skipped} not checked)" if skipped else ""
    if skipped == len(checks):
        return "overall: not checked: none of the checks could be made", 1
    if failed:
        return f"overall: {len(failed)} check(s) found a source kept off the board; first: {failed[0].name} {failed[0].reason}" + tail, 1
    return "overall: nothing found that keeps a source off the board" + tail, 0


# ---- the command -----------------------------------------------------------------------------------
def run(args, facts=None, out=print):
    if args.host:
        checks = host_checks()
        out(f"weatherdeck doctor --host: data dir {config.data_path()}")
        line, code = host_overall(checks)
    else:
        facts = facts or Facts()
        checks = machine_checks(facts, args.join_config, args.url, args.source, args.token_file, args.read_token_file,
                                getattr(args, "pusher_state", None))
        out("weatherdeck doctor: this machine's source, as the host sees it (read-only)")
        line, code = machine_overall(checks)
    for c in checks:
        out(c.line())
    out(line)
    return code
