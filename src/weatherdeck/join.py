"""Adding a machine: `weatherdeck invite` on the host and `weatherdeck join --dry-run` on the new machine.

`invite` mints a push token for a new source, records the invite in the host's invite registry (<data>/invites.json,
docs/onboarding.md) and prints ONE join string that carries the host's address, the source id, the machine id, the
expiry and the token. The host enforces the expiry: until a first push from that source is accepted, the token is
refused once the invite has expired. No new route: the check sits in the existing POST /api/ingest.

`join --dry-run` runs the preflight only and writes nothing. Each check either passes or names its failure with one next
step. What the machine is (OS, interpreter, existing installs, ...) is gathered once into a dict of facts, so a test can
inject another platform's facts (a Windows Store alias, say) on any system.
"""
import getpass
import hashlib
import http.client
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import time
from collections import namedtuple
from pathlib import Path, PureWindowsPath
from urllib.parse import urlsplit

from . import config, osx, schema, store

PREFIX = "wdjoin1:"
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{20,128}$")
TTL_RE = re.compile(r"^(\d+)([smhd])$")
TTL_DEFAULT = "15m"
TTL_MAX_S = 7 * 86400
MIN_PYTHON = (3, 9)
SCHEDULERS = ("systemd", "cron", "system")  # how a Linux join registers the beat: a user unit (the default), a crontab line, a system unit
SKEW_WARN_S = 120
TIMEOUT_S = 5.0


class JoinStringError(ValueError):
    pass


# ---- the join string -----------------------------------------------------------------------------
Invite = namedtuple("Invite", "url source machine expires token")


def _check(payload):
    return hashlib.sha256(payload.encode()).hexdigest()[:4]


def make_string(url, source, machine, expires, token):
    """wdjoin1:<url>:<source>:<machine>:<expires, epoch s>:<token>:<check>. The check (4 hex digits of a sha256 of the
    rest) catches a paste that lost or changed characters."""
    payload = f"{url.rstrip('/')}:{source}:{machine}:{int(expires)}:{token}"
    return f"{PREFIX}{payload}:{_check(payload)}"


def parse_string(text):
    """-> Invite. The error never repeats the string: it holds a secret."""
    text = (text or "").strip()
    if not text.startswith(PREFIX):
        raise JoinStringError(f"it does not start with {PREFIX}")
    parts = text[len(PREFIX):].rsplit(":", 5)  # the url may hold colons; nothing after it does
    if len(parts) != 6:
        raise JoinStringError("it has too few parts")
    url, source, machine, expires, token, check = parts
    if _check(":".join(parts[:5])) != check:
        raise JoinStringError("its check digits do not match (a character was lost or changed in the copy)")
    try:
        u = urlsplit(url)
        ok = u.scheme in ("http", "https") and u.hostname and u.path in ("", "/") and not u.query and (u.port or True)
    except ValueError:
        ok = False
    if not ok:
        raise JoinStringError("its host address is not an http:// address")
    if not schema.ID_RE.match(source) or not schema.ID_RE.match(machine):
        raise JoinStringError("its source or machine id is not 1-48 characters from a-z 0-9 . _ -")
    if not expires.isdigit() or not TOKEN_RE.match(token):
        raise JoinStringError("its expiry or token is malformed")
    return Invite(url.rstrip("/"), source, machine, int(expires), token)


def parse_ttl(text):
    m = TTL_RE.match((text or "").strip().lower())
    if not m:
        raise ValueError("give the TTL as a number and one of s m h d, e.g. 15m or 2h")
    secs = int(m.group(1)) * {"s": 1, "m": 60, "h": 3600, "d": 86400}[m.group(2)]
    if not 60 <= secs <= TTL_MAX_S:
        raise ValueError("the TTL must be between 1m and 7d")
    return secs


def _iso(t):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def _span(secs):
    secs = int(abs(secs))
    if secs < 120:
        return f"{secs} s"
    if secs < 7200:
        return f"{secs // 60} min"
    return f"{secs // 3600} h {secs % 3600 // 60} min" if secs < 172800 else f"{secs // 86400} days"


# ---- the host's invite registry --------------------------------------------------------------------
# <data>/invites.json: {"version": 1, "invites": {<source id>: {"machine", "url", "created_at", "expires_at", "joined_at"}}}.
# Times are RFC 3339 UTC; joined_at is null until the host accepts a first push from that source. No token and no hash
# here (the hash stays in tokens.json). `weatherdeck token revoke <id>` drops the source's invite.
def registry_path():
    return config.data_dir() / "invites.json"


def read_registry():
    doc = store.read_json(registry_path(), {}) or {}
    invites = doc.get("invites") if isinstance(doc, dict) else None
    return {"version": 1, "invites": invites if isinstance(invites, dict) else {}}


def _update_registry(change):
    """Read, change and write the registry under a lock (the host marks joins while `invite` may add one)."""
    with osx.file_lock(config.data_dir() / "invites.lock"):
        doc = read_registry()
        if change(doc["invites"]) is not False:
            store.write_json_atomic(registry_path(), doc)


def forget_invite(source):
    _update_registry(lambda inv: False if inv.pop(source, None) is None else None)


def invite_refusal(source, now=None):
    """Why a push from `source` is refused because its invite expired before a first push was accepted, or None.
    A source the host has already received is never refused here, even with a stale registry."""
    inv = read_registry()["invites"].get(source)
    if not isinstance(inv, dict) or inv.get("joined_at"):
        return None
    try:
        expires = schema.parse_time(inv["expires_at"])
    except (KeyError, TypeError, ValueError):
        return None
    if (now if now is not None else time.time()) < expires or (store.sources_dir() / f"{source}.json").exists():
        return None
    return (f"this invite expired at {inv['expires_at']} before a first push from {source} was accepted; "
            f"run 'weatherdeck invite --machine {inv.get('machine') or '<id>'}' on the host again")


def mark_joined(source, now=None):
    """Note the first accepted push of an invited source (once; later pushes read the registry and write nothing)."""
    inv = read_registry()["invites"].get(source)
    if not isinstance(inv, dict) or inv.get("joined_at"):
        return

    def change(invites):
        cur = invites.get(source)
        if not isinstance(cur, dict) or cur.get("joined_at"):
            return False
        cur["joined_at"] = _iso(now if now is not None else time.time())

    _update_registry(change)


# ---- weatherdeck invite (host side) -------------------------------------------------------------------
def _host_urls(cfg):
    """The addresses this host listens on: the running host's, else what the config would bind (auto: ranges
    included only when their address is present now)."""
    from . import hostinfo, server
    state = store.read_json(server.state_path()) or {}
    urls = [u.rstrip("/") for u in state.get("urls") or [] if isinstance(u, str)]
    if not urls:
        try:
            addrs, _ = hostinfo.resolve(cfg["hosts"]["bind"], list(cfg["profiles"]))
        except hostinfo.BindError:
            addrs = {}
        port = cfg["hosts"]["port"]
        urls = [f"http://{'[' + a + ']' if ':' in a else a}:{port}" for a in addrs]
    return urls


def _is_loopback(url):
    import ipaddress
    name = urlsplit(url).hostname or ""
    if name == "localhost":
        return True
    try:
        return ipaddress.ip_address(name).is_loopback
    except ValueError:
        return False


def cmd_invite(args):
    from . import hostinfo, server
    cfg = config.get()
    machine = (args.machine or "").strip()
    source = (args.source or f"beat-{machine}").strip()
    if not schema.ID_RE.match(machine) or not schema.ID_RE.match(source):
        print("give --machine (and --source, default beat-<machine>) as 1-48 characters from a-z 0-9 . _ -")
        return 2
    try:
        ttl = parse_ttl(args.ttl or TTL_DEFAULT)
    except ValueError as exc:
        print(f"--ttl: {exc}")
        return 2
    notes = []
    if args.url:
        url = args.url.strip().rstrip("/")
        u = urlsplit(url)
        if u.scheme not in ("http", "https") or not u.hostname or u.path not in ("", "/"):
            print("--url: give the address the new machine will use, as http://NAME-OR-IP:PORT")
            return 2
        if hostinfo.canonical_name(u.hostname) not in hostinfo.allowed_names(cfg) and not any(
                urlsplit(h).hostname == u.hostname for h in _host_urls(cfg)):
            notes.append(f"note: {u.hostname} is not one of this host's names, so the host will refuse it "
                         f"(HOST_NAME_REFUSED): add it to hosts.allowed_hosts in {config.config_path()} (re-read live)")
    else:
        urls = _host_urls(cfg)
        reach = [u for u in urls if not _is_loopback(u)]
        if not urls:
            print("this host has no address to offer (hosts.bind resolves to nothing now); give --url http://ADDRESS:PORT")
            return 1
        url = (reach or urls)[0]
        if not reach:
            notes.append("note: this host listens on localhost only, so only this computer can use the string; for another machine set "
                         "hosts.bind to an address it can reach (docs/hosting.md), restart, and invite again, or give --url")
    tokens_doc = store.read_json(server.tokens_path(), {}) or {}
    tokens = tokens_doc.setdefault("tokens", {})
    open_invite = read_registry()["invites"].get(source)
    open_invite = open_invite if isinstance(open_invite, dict) and not open_invite.get("joined_at") else None
    reported = (store.sources_dir() / f"{source}.json").exists()
    if reported or (source in tokens and not open_invite):
        why = "already reports to this host" if reported else "already has a push token"
        print(f"ID_TAKEN: source {source} {why}; nothing was changed.\n"
              f"  next: invite with another --machine (or --source), or retire it first with 'weatherdeck token revoke {source}'"
              + (f" and 'weatherdeck forget {source}'" if reported else ""))
        return 1
    now = time.time()
    expires = int(now + ttl)
    token = secrets.token_urlsafe(32)

    def add(invites):
        invites[source] = {"machine": machine, "url": url, "created_at": _iso(now), "expires_at": _iso(expires), "joined_at": None}

    _update_registry(add)  # the record first: a token without one would never expire
    first = not tokens
    tokens[source] = hashlib.sha256(token.encode()).hexdigest()
    store.write_json_atomic(server.tokens_path(), tokens_doc)
    if open_invite:
        print(f"this replaces the open invite for {source}; its string no longer works")
    print(f"invite for machine {machine}, source {source}, host {url}")
    print(f"expires {_iso(expires)} ({_span(ttl)}): the host refuses this token if no push from {source} has been accepted by then.")
    print("join string (a secret, shown once; the host keeps only the token's hash):")
    print(make_string(url, source, machine, expires, token))
    print("on the new machine run 'weatherdeck join --dry-run' and paste the string at its prompt (kept out of the process list).")
    print(f"withdraw it any time: weatherdeck token revoke {source}")
    if first:
        from .cli import first_token_note
        print("note: " + first_token_note())
    for n in notes:
        print(n)
    return 0


# ---- facts about the machine that joins ---------------------------------------------------------------
def _run(cmd, timeout=6):
    """(returncode, stdout) of a read-only command; (None, '') when it cannot be run."""
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return res.returncode, res.stdout
    except (OSError, subprocess.SubprocessError):
        return None, ""


def this_os():
    return "darwin" if sys.platform == "darwin" else "windows" if osx.IS_WIN else "linux"


def is_wsl():
    try:
        with open("/proc/version", encoding="utf-8", errors="replace") as fh:
            return "microsoft" in fh.read().lower()
    except OSError:
        return False


def machine_ids(hostname, wsl):
    """The machine id each existing path would pick on this computer: an adapter installer's `hostname -s`
    (the rule adapter install scripts use) and the beat's own default (bin/weatherdeck-beat `default_machine_id`). Inside WSL they differ (B10)."""
    short = (hostname or "").split(".")[0].lower()
    installer = re.sub(r"[^a-z0-9._-]", "-", short)
    beat = re.sub(r"[^a-z0-9._-]", "-", short).strip("-.") or "machine"
    return {"installer": installer[:48], "beat": ((beat + "-wsl") if wsl else beat)[:48]}


def default_station(os_name, wsl):
    return "Linux (WSL)" if wsl else {"windows": "Windows", "darwin": "macOS", "linux": "Linux"}.get(os_name, os_name)


def join_dirs(os_name, home, env):
    """Where a join keeps its config and state. On Windows both sit under %USERPROFILE%\\.weatherdeck, a folder the
    Store-Python redirect of %LOCALAPPDATA% cannot hide."""
    if os_name == "windows":
        base = PureWindowsPath(env.get("USERPROFILE") or home) / ".weatherdeck"
        return {"config": str(base), "state": str(base / "state")}
    h = Path(home)
    if os_name == "darwin":
        return {"config": str(h / "Library" / "Application Support" / "weatherdeck"),
                "state": str(h / "Library" / "Caches" / "weatherdeck-beat")}
    return {"config": str(Path(env.get("XDG_CONFIG_HOME") or h / ".config") / "weatherdeck"),
            "state": str(Path(env.get("XDG_CACHE_HOME") or h / ".cache") / "weatherdeck-beat")}


def can_write(path):
    """Could a directory be created or written here? Asks the nearest existing folder; writes nothing."""
    p = Path(path)
    while not p.exists():
        if p.parent == p:
            return False
        p = p.parent
    return p.is_dir() and os.access(str(p), os.W_OK | os.X_OK)


BEAT_NAME = re.compile(r"(weatherdeck|lookout)-beat", re.I)
SENDER_NAME = re.compile(r"(weatherdeck|lookout)-[a-z0-9]", re.I)  # an adapter's pusher (the host's own task is "Weatherdeck host")


def find_installs(os_name, home, env, crontab="", tasks=""):
    """Earlier installs on this machine: [(kind, where, how to remove)]. kind 'beat' (a beat service or an earlier join:
    joining again would make a second sender) or 'pusher' (an adapter's pusher: a separate source that keeps running)."""
    out = []

    def add(name, where, remove):
        if BEAT_NAME.search(name):
            out.append(("beat", where, remove))
        elif SENDER_NAME.search(name):
            out.append(("pusher", where, remove))

    if os_name == "windows":
        cfg = PureWindowsPath(join_dirs(os_name, home, env)["config"]) / "join.json"
        for line in (tasks or "").splitlines():
            name = line.split(",")[0].strip().strip('"').lstrip("\\")
            if name:
                add(name, f"scheduled task {name}", f'schtasks /delete /tn "{name}" /f')
    else:
        cfg = Path(join_dirs(os_name, home, env)["config"]) / "join.json"
        if os_name == "darwin":
            d = Path(home) / "Library" / "LaunchAgents"
            for p in sorted(d.glob("*.plist")) if d.is_dir() else []:
                add(p.name, str(p), f"launchctl bootout gui/$(id -u) {p}; rm {p}")
        else:
            d = Path(env.get("XDG_CONFIG_HOME") or Path(home) / ".config") / "systemd" / "user"
            for p in sorted(d.glob("*.service")) + sorted(d.glob("*.timer")) if d.is_dir() else []:
                add(p.name, str(p), f"systemctl --user disable --now {p.name}; rm {p}")
        for line in (crontab or "").splitlines():
            if line.strip() and not line.lstrip().startswith("#"):
                add(line, "crontab line: " + line.strip()[:80], "crontab -e, and delete that line")
    if os_name == this_os() and os.path.exists(str(cfg)):
        out.insert(0, ("beat", str(cfg), f"delete {cfg} (left by an earlier join)"))
    return out


def user_name(env=os.environ.get):
    """This machine's user name, or None when it cannot be read."""
    try:
        return getpass.getuser()
    except (KeyError, OSError, ImportError):
        return env("USER") or env("LOGNAME") or None


def read_linger(run, user):
    """Whether logind keeps `user`'s systemd user manager running after the last login ends: {user, state, why}, state
    "yes", "no" or None when it could not be read (no user name, loginctl missing, or it did not answer). Reads only."""
    if not user:
        return {"user": None, "state": None, "why": "this machine's user name could not be read"}
    rc, out = run(["loginctl", "show-user", user, "-p", "Linger"])
    m = re.search(r"^Linger=(yes|no)\s*$", out, re.M) if rc == 0 else None
    if m:
        return {"user": user, "state": m.group(1), "why": "loginctl show-user"}
    why = "loginctl is not there" if rc is None else ((out.strip().splitlines() or [f"exit {rc}"])[-1][:120])
    return {"user": user, "state": None, "why": why}


def gather_facts(python=None, run=_run, scheduler="systemd"):
    """Everything the preflight needs to know about this machine, read without writing anything."""
    os_name = this_os()
    wsl = os_name == "linux" and is_wsl()
    env = {k: os.environ.get(k) for k in ("USERPROFILE", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_CACHE_HOME") if os.environ.get(k)}
    home = str(Path.home())
    if python:
        rc, out = run([python, "-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"])
        m = re.match(r"^(\d+)\.(\d+)\.(\d+)", out.strip()) if rc == 0 else None
        py = {"path": python, "base": None, "version": tuple(int(x) for x in m.groups()) if m else None}
    else:
        py = {"path": sys.executable, "base": getattr(sys, "_base_executable", None), "version": tuple(sys.version_info[:3])}
    facts = {"os": os_name, "wsl": wsl, "hostname": socket.gethostname(), "python": py, "home": home, "env": env,
             "py_launcher": [], "dirs": join_dirs(os_name, home, env), "can_write": can_write, "scheduler": scheduler}
    crontab = tasks = ""
    if os_name == "windows":
        _, out = run(["py", "-0p"])
        facts["py_launcher"] = [m.group(1).strip() for m in re.finditer(r"^\s*\S.*?\s((?:[A-Za-z]:\\|\\\\).+?\.exe)\s*$", out, re.M)]
        _, tasks = run(["schtasks", "/query", "/fo", "csv", "/nh"])
        facts["service"] = (shutil.which("schtasks") is not None, "Task Scheduler")
    else:
        if os_name == "darwin":
            facts["service"] = (shutil.which("launchctl") is not None, "launchd")
        else:
            rc, _ = run(["systemctl", "--user", "show-environment"])
            facts["service"] = (rc == 0, "systemd user manager")
            if not wsl:
                facts["linger"] = read_linger(run, user_name())
                facts["system_manager"] = os.path.isdir("/run/systemd/system")
        facts["crontab"] = shutil.which("crontab") is not None
        rc, crontab = run(["crontab", "-l"])
        crontab = crontab if rc == 0 else ""
    facts["installs"] = find_installs(os_name, home, env, crontab, tasks)
    return facts


# ---- talking to the host -------------------------------------------------------------------------------
class Unreachable(Exception):
    def __init__(self, kind, detail):
        super().__init__(detail)
        self.kind, self.detail = kind, detail


class _Conn(http.client.HTTPConnection):
    """An HTTP connection whose socket may go to another address than its Host header names (tests use it to reach a
    scratch host under a name the host does not hold)."""

    def __init__(self, host, port, timeout, connect_to=None):
        super().__init__(host, port, timeout=timeout)
        self._connect_to = connect_to

    def connect(self):
        self.sock = socket.create_connection((self._connect_to or self.host, self.port), self.timeout)


class Http:
    def __init__(self, url, timeout=TIMEOUT_S, connect_to=None):
        u = urlsplit(url)
        self.https, self.host, self.timeout, self.connect_to = u.scheme == "https", u.hostname, timeout, connect_to
        self.port = u.port or (443 if self.https else 80)
        self.where = f"{u.hostname}:{self.port}"

    def _conn(self):
        if self.https:
            return http.client.HTTPSConnection(self.host, self.port, timeout=self.timeout)
        return _Conn(self.host, self.port, self.timeout, self.connect_to)

    def request(self, method, path, headers=None):
        """-> (status, body text). Raises Unreachable(kind in dns|refused|timeout|error)."""
        conn = self._conn()
        try:
            conn.putrequest(method, path, skip_accept_encoding=True)
            for k, v in (headers or {}).items():
                conn.putheader(k, v)
            conn.endheaders()  # no body and no Content-Length: a POST stops at the host's length check
            resp = conn.getresponse()
            return resp.status, resp.read(256 * 1024).decode("utf-8", "replace")
        except socket.gaierror as exc:
            raise Unreachable("dns", f"the name {self.host} does not resolve here ({exc.strerror or exc})")
        except ConnectionRefusedError:
            raise Unreachable("refused", f"nothing accepts connections on {self.where}")
        except (socket.timeout, TimeoutError):
            raise Unreachable("timeout", f"no answer from {self.where} in {self.timeout:g} s")
        except http.client.HTTPException as exc:
            raise Unreachable("error", f"{self.where} did not answer as an HTTP server ({type(exc).__name__})")
        except OSError as exc:
            raise Unreachable("error", f"{self.where}: {exc.strerror or exc}")
        finally:
            conn.close()

    def get(self, path):
        return self.request("GET", path, {"Accept": "application/json"})

    def probe(self, token):
        """The harmless token probe: POST /api/ingest with the token and no body. The host checks the token before the
        length, so it answers 411 when the token is good and 401 when not, and stores nothing either way."""
        return self.request("POST", "/api/ingest", {"Content-Type": "application/json", "Authorization": "Bearer " + token})


# ---- the preflight ------------------------------------------------------------------------------------
Finding = namedtuple("Finding", "level name text next")  # level: ok, warn, FAIL, skip


def _ok(text):
    return Finding("ok", None, text, None)


def _python_checks(facts):
    py = facts["python"]
    found = []
    v = py.get("version")
    if v is None:
        found.append(Finding("FAIL", "PYTHON_NOT_RUNNABLE", f"{py['path']} could not be run to read its version",
                             "pass --python with the full path of a Python 3.9 or newer interpreter"))
    elif tuple(v[:2]) < MIN_PYTHON:
        found.append(Finding("FAIL", "PYTHON_TOO_OLD", f"Python {'.'.join(map(str, v))} at {py['path']} is older than 3.9, which this needs",
                             "install Python 3.9 or newer (python.org), or pass --python with the path of one"))
    else:
        found.append(_ok(f"Python {'.'.join(map(str, v))} at {py['path']}"))
    if facts["os"] == "windows":
        found.append(store_alias_check(py, facts.get("py_launcher") or []))
    return found


def _under_windowsapps(path):
    return bool(path) and "\\windowsapps\\" in str(path).replace("/", "\\").lower()


def store_alias_check(py, launcher_paths):
    """On Windows the service must register a real interpreter: a path under \\WindowsApps\\ is the Microsoft Store's App
    Execution Alias or its sandboxed package, which runs and never delivers (B2)."""
    bad = next((p for p in (py.get("path"), py.get("base")) if _under_windowsapps(p)), None)
    if not bad:
        return _ok(f"a real interpreter, not the Microsoft Store alias ({py.get('base') or py.get('path')})")
    real = [p for p in launcher_paths if not _under_windowsapps(p)]
    hint = (f"pass --python {PureWindowsPath(real[0]).with_name('pythonw.exe')} (found by py -0p)" if real
            else "install Python from python.org (not the Microsoft Store), then pass --python with its pythonw.exe")
    return Finding("FAIL", "STORE_ALIAS", f"only the Microsoft Store alias was found ({bad}); it runs but never delivers", hint)


def _native_linux(facts):
    return facts.get("os") == "linux" and not facts.get("wsl")


def _machine_checks(facts):
    found = []
    ok, what = facts.get("service") or (False, "a service manager")
    if ok:
        found.append(_ok(f"{what} available"))
    elif not _native_linux(facts) or (facts.get("scheduler") or "systemd") == "systemd":
        nxt = ("enable systemd in WSL ([boot] systemd=true in /etc/wsl.conf, then wsl --shutdown), or run the beat in the "
               "foreground; it then reports only while WSL runs" if facts.get("wsl")
               else "run the beat in the foreground (docs/beat.md); it then reports only while that terminal runs")
        found.append(Finding("FAIL", "NO_SERVICE_MANAGER", f"no {what} answers here", nxt))
    write = facts.get("can_write") or can_write
    for role, d in sorted((facts.get("dirs") or {}).items()):
        found.append(_ok(f"{role} folder {d} can be written") if write(d) else
                     Finding("FAIL", "CANNOT_WRITE", f"the {role} folder {d} cannot be created or written by this user",
                             f"give this user write access to {d} (or its parent)"))
    for kind, where, remove in facts.get("installs") or []:
        if kind == "beat":
            found.append(Finding("FAIL", "ALREADY_JOINED", f"this machine already has a beat or join install: {where}",
                                 f"remove it first: {remove}"))
        else:
            found.append(_ok(f"also here: an adapter's pusher ({where}); it is its own source and keeps running, and the join adds the beat beside it"))
    return found


def _systemd_user_path(where):
    return "/systemd/user/" in str(where).replace("\\", "/")


def linger_checks(facts):
    """Linux only (WSL keeps its own findings, and so does a host without a systemd user manager unless cron or a system
    unit was chosen). A systemd USER unit lives in the
    user's manager, which logind stops when the last login session of that user ends unless lingering is on: the unit is
    then gone until the next login, and the board shows the machine missing in between. So a plan that registers a user
    unit is not ready while lingering is off or unreadable, unless a cron or system-level scheduler was chosen instead."""
    linger, how = facts.get("linger"), facts.get("scheduler") or "systemd"
    manager = (facts.get("service") or (False,))[0]
    if not _native_linux(facts) or not linger or (how == "systemd" and not manager):
        return []
    state = linger.get("state")
    user = linger.get("user") or "this user"
    remedy = f"loginctl enable-linger {linger['user']}" if linger.get("user") else "loginctl enable-linger"
    show = f"loginctl show-user {linger['user']} -p Linger" if linger.get("user") else "loginctl show-user $(id -un) -p Linger"
    found = []
    if how == "systemd":
        if state == "yes":
            found.append(_ok(f"lingering is on for {user}: the systemd user unit keeps running after the last login session ends"))
        elif state == "no":
            found.append(Finding("FAIL", "LINGER_OFF", f"lingering is off for {user}: a systemd user unit stops when the last login session "
                                 f"of {user} ends (the user manager exits and takes the unit with it) and returns only at the next login, "
                                 "so the board shows this machine as missing in between",
                                 f"{remedy}   (run it once as {user}; or run this again with --scheduler cron)"))
        else:
            found.append(Finding("FAIL", "LINGER_UNKNOWN", f"whether lingering is on for {user} could not be read ({linger.get('why')}), and a systemd "
                                 "user unit stops when the last login session ends unless it is",
                                 f"{show}   (then {remedy} if it says Linger=no; or run this again with --scheduler cron)"))
    else:
        what = "a crontab line" if how == "cron" else "a system-level unit"
        have = {"yes": "on", "no": "off"}.get(state, "not readable")
        found.append(_ok(f"the plan registers {what}, which does not depend on a login session; lingering is {have} for {user} and is left as found"))
        if how == "cron" and not facts.get("crontab", True):
            found.append(Finding("FAIL", "NO_CRON", "--scheduler cron was chosen, but there is no crontab command on this machine",
                                 "install cron (the crontab command), or choose --scheduler system"))
        if how == "system" and not facts.get("system_manager", True):
            found.append(Finding("FAIL", "NO_SERVICE_MANAGER", "--scheduler system was chosen, but no systemd system manager runs on this machine",
                                 "choose --scheduler cron, or run the beat in the foreground (docs/beat.md)"))
    if state != "yes" and manager:
        for kind, where, _ in facts.get("installs") or []:
            if kind == "pusher" and _systemd_user_path(where):
                found.append(Finding("warn", "PUSHER_AT_RISK", f"the adapter's pusher here ({where}) is a systemd user unit, so it stops the same "
                                     f"way when the last login session of {user} ends, whatever the beat uses",
                                     f"{remedy}   (the join never runs it)"))
    return found


def _host_checks(inv, facts, http, now):
    """Reachability, version, clock, token and id. Stops at the first failure that leaves nothing to ask."""
    found = []
    try:
        t0 = now()
        code, body = http.get("/healthz")
        t1 = now()
    except Unreachable as exc:
        nxt = {"dns": "check the address in the join string from this machine (a name on a VPN or private network needs this machine on it)",
               "refused": "check the host runs ('weatherdeck status' on the host) and that hosts.bind includes an address this machine can reach",
               "timeout": "a firewall or the network drops the connection: on a Windows host allow Python on Private networks; "
                          "check both machines share a network or VPN",
               "error": "check that the address in the join string is the Weatherdeck host's"}[exc.kind]
        found.append(Finding("FAIL", f"HOST_UNREACHABLE ({exc.kind})", exc.detail, nxt))
        return found + [Finding("skip", None, "token, clock and id checks: the host was not reached", None)]
    if code == 403:
        found.append(Finding("FAIL", "HOST_NAME_REFUSED", f"the host refused the name {http.host!r}: {body.strip()[:160]}",
                             f"on the host, add {http.host} to hosts.allowed_hosts in its config (re-read live), or invite with --url using a name it holds"))
        return found + [Finding("skip", None, "token, clock and id checks: the host refused the name", None)]
    try:
        health = json.loads(body) if code == 200 else None
    except ValueError:
        health = None
    if not isinstance(health, dict) or not health.get("ok"):
        found.append(Finding("FAIL", "NOT_WEATHERDECK", f"{http.where} answered /healthz with HTTP {code}, not as a Weatherdeck host",
                             "check that the address in the join string is the Weatherdeck host's"))
        return found + [Finding("skip", None, "token, clock and id checks: not a Weatherdeck host", None)]
    if not isinstance(health.get("now"), (int, float)) or not health.get("version"):
        found.append(Finding("FAIL", "HOST_TOO_OLD", f"the host ({health.get('version') or 'version unknown'}) does not report its clock",
                             "upgrade the host first"))
        return found
    found.append(_ok(f"host reachable at {http.where} (Weatherdeck {health['version']})"))
    skew = health["now"] - (t0 + t1) / 2
    if abs(skew) > SKEW_WARN_S:
        found.append(Finding("warn", "CLOCK_SKEW", f"{int(round(skew))} s: this machine's clock is {_span(skew)} "
                             f"{'behind' if skew > 0 else 'ahead of'} the host's (the host judges staleness on its own clock, so the board stays right)",
                             "turn on network time on this machine; the board shows the skew anyway"))
    else:
        found.append(_ok(f"clock skew {skew:+.1f} s against the host"))
    left = inv.expires - health["now"]
    try:
        code, body = http.probe(inv.token)
    except Unreachable as exc:
        found.append(Finding("FAIL", f"HOST_UNREACHABLE ({exc.kind})", f"the token probe failed: {exc.detail}", "run the dry run again"))
        return found
    text = body.strip().splitlines()[0][:200] if body.strip() else ""
    if code == 411:
        found.append(_ok("the host accepts this token (the probe stopped at the length check; nothing was stored)"
                         + (f"; the invite is open for {_span(left)} more" if left > 0 else "")))
    elif code == 401 and "expired" in text:
        found.append(Finding("FAIL", "INVITE_EXPIRED", text, f"run 'weatherdeck invite --machine {inv.machine}' on the host again and use the new string"))
    elif code in (401, 403):
        found.append(Finding("FAIL", f"TOKEN_REFUSED ({code})", f"the host does not take this token: {text or 'no reason given'}",
                             f"run 'weatherdeck invite --machine {inv.machine}' on the host again and use the new string"))
    else:
        found.append(Finding("FAIL", "PROBE_FAILED", f"the token probe got HTTP {code}: {text or 'no reason given'}",
                             "run 'weatherdeck logs' on the host to see why"))
    found += _id_checks(inv, facts, http)
    return found


def _id_checks(inv, facts, http):
    """Is the source id free, and does the machine id agree with what this computer already reports as (B10)?"""
    try:
        code, body = http.get("/api/view")
        view = (json.loads(body) or {}).get("view") if code == 200 else None
    except (Unreachable, ValueError, AttributeError):
        code, view = None, None
    if not isinstance(view, dict) or not isinstance(view.get("sources"), list):
        why = "the host's view needs a read token" if code == 401 else f"the host's view did not answer ({code or 'no answer'})"
        return [Finding("warn", "ID_UNCHECKED", f"whether {inv.source} is free could not be asked: {why}",
                        "on the host, 'weatherdeck status' lists the sources and machines that report")]
    sources = [s for s in view["sources"] if isinstance(s, dict) and not s.get("placeholder")]
    mine = next((s for s in sources if s.get("id") == inv.source), None)
    if mine:
        return [Finding("FAIL", "ID_TAKEN", f"source {inv.source} already reports to this host, as machine {mine.get('machine') or '(none)'}",
                        "this invite was used already; if that was not this machine, ask for a new one with another --machine")]
    ships = {}
    for s in sources:
        if s.get("machine"):
            ships.setdefault(s["machine"], []).append(s["id"])
    for m in view.get("machines") or []:
        if isinstance(m, dict) and m.get("id") and not m.get("synthesized"):
            ships.setdefault(m["id"], [])
    ids = machine_ids(facts.get("hostname"), facts.get("wsl"))
    station = default_station(facts.get("os"), facts.get("wsl"))
    found = [_ok(f"source {inv.source} is free; machine id {inv.machine}, station {station}")]
    for d in sorted(set(ids.values()) - {inv.machine}):
        if d in ships:
            found.append(Finding("warn", "MACHINE_ID_DIFFERS",
                                 f"this computer already reports as machine {d} (" + (", ".join(ships[d]) or "seen") + f"); joining as {inv.machine} draws it as a second ship",
                                 f"ask for the invite with --machine {d}, so both report as stations of one ship"))
    if inv.machine in ships and inv.machine not in ids.values():
        found.append(Finding("warn", "MACHINE_ID_SHARED",
                             f"machine {inv.machine} is already a ship on the host (" + (", ".join(ships[inv.machine]) or "seen")
                             + f"), and this computer's own name gives {ids['beat']}: if that ship is another computer, both are drawn as one",
                             "if it is another computer, ask for the invite with another --machine"))
    return found


def preflight(inv, facts, http, now=time.time):
    """-> [Finding]. Writes nothing anywhere, and the token probe stores nothing on the host."""
    return _python_checks(facts) + _machine_checks(facts) + linger_checks(facts) + _host_checks(inv, facts, http, now)


def plan_lines(inv, facts):
    """What a join registers on this machine, and what it leaves alone. The beat (bin/weatherdeck-beat, docs/beat.md) goes in
    with every join, so every machine that reports has one the board can read, a pusher or not. This version describes the plan
    and checks it; it registers nothing."""
    from . import doctor
    os_name, how = facts.get("os"), facts.get("scheduler") or "systemd"
    name = doctor.service_name(os_name, inv.source)
    if _native_linux(facts) and how == "cron":
        unit, undo = "a crontab line that starts the beat every minute (the beat holds a lock, so a second start exits)", "crontab -e, and delete that line"
    elif _native_linux(facts) and how == "system":
        unit, undo = f"a system unit {name} that runs as {(facts.get('linger') or {}).get('user') or user_name() or 'this user'}", f"systemctl disable --now {name} as root, and delete its unit file"
    else:
        kind = {"linux": "a systemd user unit", "darwin": "a LaunchAgent", "windows": "a Task Scheduler task"}.get(os_name, "a service")
        unit, undo = f"{kind} {name}", f"remove {name} (the exact command is printed if it is found later)"
    lines = ["plan: what a join registers (this version checks it and registers nothing):",
             f"  beat   {unit}: `weatherdeck-beat run --push {inv.url}` as source {inv.source}, machine {inv.machine}"
             + ("; with the same scheduler and the same lingering rule as a pusher on this machine" if how == "systemd" else "")]
    if how != "systemd" and not _native_linux(facts):
        lines.append(f"  note   --scheduler {how} applies to Linux outside WSL only; here the beat goes in as {unit}")
    pushers = [w for k, w, _ in facts.get("installs") or [] if k == "pusher"]
    if pushers:
        lines.append(f"  pusher {len(pushers)} adapter pusher(s) already here stay as their own source(s); the beat is added beside them")
    linger = facts.get("linger")
    if linger:
        state = {"yes": "on", "no": "off"}.get(linger.get("state"), "not readable")
        lines.append(f"  linger found {state} for {linger.get('user') or 'this user'}; changed by the join: no. The join never runs enable-linger or "
                     "disable-linger, and removing it later leaves linger exactly as found")
    lines.append(f"  undo   {undo}")
    return lines


def render(inv, findings, facts=None):
    lines = [f"weatherdeck join --dry-run: machine {inv.machine}, source {inv.source}, host {inv.url}; nothing is written"]
    for f in findings:
        if f.level in ("ok", "skip"):
            lines.append(f"  {f.level:<5} {f.text}")
        else:
            lines.append(f"  {f.level:<5} {f.name}: {f.text}")
            lines.append(f"        next: {f.next}")
    if facts:
        lines += plan_lines(inv, facts)
    fails = [f.name for f in findings if f.level == "FAIL"]
    warns = [f.name for f in findings if f.level == "warn"]
    lines.append("result: " + (f"{len(fails)} named failure(s): " + ", ".join(fails) + "; the plan is not verified" if fails else "ready to join")
                 + (f"; warnings: {', '.join(warns)}" if warns else "") + "; nothing was written")
    return "\n".join(lines)


def read_join_string(arg):
    """The string from the argument, else from a hidden prompt or one line of stdin (the safe way: argv is visible in
    the process list and in shell history)."""
    if arg and arg != "-":
        return arg
    if sys.stdin.isatty():
        return getpass.getpass("join string (input hidden): ")
    return sys.stdin.readline()


def cmd_join(args):
    if not args.dry_run:
        print("weatherdeck join: this version runs the preflight only; add --dry-run. Installing the service comes later.")
        return 2
    try:
        inv = parse_string(read_join_string(args.string))
    except JoinStringError as exc:
        print(f"  FAIL  JOIN_STRING_DAMAGED: the join string cannot be read: {exc}\n"
              "        next: copy the whole string again from the host, or ask for a new one with 'weatherdeck invite'")
        return 1
    except (EOFError, KeyboardInterrupt):
        print("no join string given")
        return 2
    facts = gather_facts(python=args.python, scheduler=getattr(args, "scheduler", None) or "systemd")
    findings = preflight(inv, facts, Http(inv.url, timeout=args.timeout))
    print(render(inv, findings, facts))
    return 1 if any(f.level == "FAIL" for f in findings) else 0
