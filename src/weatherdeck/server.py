"""The host: static page, merged view, health, and the authenticated POST ingest.

GET/HEAD serve the page and /api/view; the only write path is POST /api/ingest, which needs a
per-source bearer token (or, until the first token exists, a loopback caller); a token minted by `weatherdeck invite`
is refused once its invite expired before a first push was accepted (join.py). Every request must
carry one of this host's own Host names (DNS rebinding), and an ingest POST must be application/json
and must not carry a foreign Origin (a web page cannot push to a board it can reach).
"""
import gzip
import hashlib
import hmac
import ipaddress
import json
import logging
import mimetypes
import secrets
import signal
import socketserver
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit

from . import VERSION, cards, config, hostinfo, ingest, join, osx, store, themes, view

log = logging.getLogger("weatherdeck.server")

INSTANCE = secrets.token_hex(8)  # lets `weatherdeck off` confirm that a pid is this host before stopping it
STATIC = {"/": "index.html", "/index.html": "index.html", "/style.css": "style.css", "/favicon.svg": "favicon.svg",
          "/theme.js": "theme.js", "/model.js": "model.js", "/board.js": "board.js", "/frontdoor.js": "frontdoor.js", "/decks.js": "decks.js", "/page.js": "page.js", "/sightings.js": "sightings.js", "/livery.js": "livery.js", "/weather.js": "weather.js", "/world.js": "world.js", "/app.js": "app.js"}
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "
       "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
MAX_BODY = 512 * 1024
BUCKET_S = 15


# ---- tokens ----------------------------------------------------------------------------------
def tokens_path():
    return config.data_dir() / "tokens.json"


def load_tokens():
    return (store.read_json(tokens_path(), {}) or {}).get("tokens") or {}


def privacy_path():
    return config.data_dir() / "privacy.on"


def privacy_on():
    """Privacy mode: a marker file (`weatherdeck privacy on`) that makes every profile marked
    `privacy` show counts only, for as long as it exists. Read on every view build."""
    try:
        return privacy_path().exists()
    except OSError:
        return False


def effective_redaction(profile_cfg):
    private = bool(profile_cfg.get("privacy")) and privacy_on()
    return ("public" if private else profile_cfg["redaction"]), private


def read_token_hash(profile):
    return ((store.read_json(tokens_path(), {}) or {}).get("read") or {}).get(profile)


def token_source(header):
    """Source id a bearer token is bound to, or None."""
    if not header or not header.lower().startswith("bearer "):
        return None
    digest = hashlib.sha256(header[7:].strip().encode()).hexdigest()
    found = None
    for sid, want in load_tokens().items():
        if hmac.compare_digest(digest, want):
            found = sid
    return found


# ---- refused ingest pushes --------------------------------------------------------------------
# The last refusal per client address, kept in memory only (gone at restart; the log line is the record). A 401 or the
# "no tokens yet" 403 is logged at most once per address per 10 minutes, so a pusher retrying every few seconds is
# one line, not a flood; the line says how many more came since the last one.
REFUSAL_LOG_EVERY_S = 600
REFUSALS_KEPT = 256
_refusals = {}
_refusals_lock = threading.Lock()


def note_refusal(addr, code, why, now=None):
    """Remember this refusal as the address's last. Returns how many refusals from it went unlogged since the last
    logged one, or None when this one should not be logged (one was logged under 10 minutes ago)."""
    now = now if now is not None else time.time()
    with _refusals_lock:
        rec = _refusals.pop(addr, None) or {"logged_at": None, "held": 0}
        loud = rec["logged_at"] is None or now - rec["logged_at"] >= REFUSAL_LOG_EVERY_S
        held = rec["held"]
        _refusals[addr] = {"at": now, "code": code, "why": why, "logged_at": now if loud else rec["logged_at"],
                           "held": 0 if loud else held + 1}
        while len(_refusals) > REFUSALS_KEPT:
            _refusals.pop(next(iter(_refusals)))
    return held if loud else None


def last_refusals():
    """address -> {at, code, why} for the last refused ingest push from each address, newest last."""
    with _refusals_lock:
        return {a: {k: r[k] for k in ("at", "code", "why")} for a, r in _refusals.items()}


# ---- view cache ------------------------------------------------------------------------------
_cache = {"key": None, "body": None, "gz": None, "etag": None}
_cache_lock = threading.Lock()
_ui = {"stamp": None, "version": None}


def ui_version():
    files = sorted(f for f in config.WEB.rglob("*") if f.is_file())
    stamp = tuple((str(f), f.stat().st_mtime_ns, f.stat().st_size) for f in files)
    if stamp != _ui["stamp"]:
        h = hashlib.sha1(VERSION.encode())
        for f in files:
            h.update(f.read_bytes())
        _ui.update(stamp=stamp, version=f"{VERSION}-{h.hexdigest()[:8]}")
    return _ui["version"]


_pkg = {"stamp": None, "value": None}


def package_version():
    """What this host actually runs: a short hash of every Python and JSON file of the weatherdeck package (the page's own
    files are in ui_version). {hash, files}; None when the files cannot be read, said as unknown, never as a hash."""
    try:
        files = sorted(f for f in config.PKG.rglob("*") if f.is_file() and f.suffix in (".py", ".json") and "__pycache__" not in f.parts)
        stamp = tuple((str(f), f.stat().st_mtime_ns, f.stat().st_size) for f in files)
        if stamp != _pkg["stamp"]:
            h = hashlib.sha1(VERSION.encode())
            for f in files:
                h.update(f.relative_to(config.PKG).as_posix().encode())
                h.update(f.read_bytes())
            _pkg.update(stamp=stamp, value={"hash": h.hexdigest()[:8], "files": len(files)})
        return _pkg["value"]
    except OSError:
        return None


def _stamp_dir(d):
    out = []
    for p in sorted(Path(d).glob("*.json")):
        try:
            st = p.stat()
            out.append((p.name, st.st_mtime_ns, st.st_size))
        except FileNotFoundError:
            pass
    return tuple(out)


def public_config(cfg):
    theme = dict(cfg["theme"], logo=bool(cfg["theme"].get("logo")), name=themes.resolve(cfg["theme"].get("name")))
    return {
        "title": cfg["title"], "labels": cfg["labels"], "labels_set": config.user_labels(), "theme": theme,
        "themes": themes.names(), "display": cfg["display"], "sound": cfg["sound"], "thresholds": cfg["thresholds"],
        "poll": cfg["poll"],
    }


def view_body(profile):
    """(json bytes, gzip bytes, etag), rebuilt when a source changed or every BUCKET_S seconds."""
    cfg = config.get()
    now = time.time()
    redaction, private = effective_redaction(cfg["profiles"][profile])
    key = (_stamp_dir(store.sources_dir()), _stamp_dir(store.rejected_dir()), _stamp_dir(cards.drop_dir()), json.dumps(cfg, sort_keys=True),
           profile, redaction, int(now // BUCKET_S), ui_version())
    with _cache_lock:
        if _cache["key"] != key:
            built = view.build(now, redaction)
            built["profile"] = {"name": profile, "redaction": redaction, "privacy": private}
            doc = {"view": built,
                   "server": {"version": ui_version(), "host": hostinfo.host_label(cfg), "config": public_config(cfg)}}
            body = json.dumps(doc, separators=(",", ":")).encode()
            _cache.update(key=key, body=body, gz=gzip.compress(body, 5), etag='"' + hashlib.sha1(body).hexdigest()[:16] + '"')
        return _cache["body"], _cache["gz"], _cache["etag"]


# ---- HTTP ------------------------------------------------------------------------------------
def _cookie_value(header, name):
    for part in (header or "").split(";"):
        k, _, v = part.strip().partition("=")
        if k == name:
            return v
    return None


class Handler(BaseHTTPRequestHandler):
    server_version = "weatherdeck"
    sys_version = ""

    def version_string(self):
        return "weatherdeck"

    def setup(self):
        super().setup()
        self.connection.settimeout(config.get()["hosts"]["request_timeout_s"])

    def log_message(self, fmt, *args):  # request lines are noise; faults are logged below
        pass

    def _refuse(self, code, why, head=False, headers=None, detail=None, quiet=False):
        """Send a plain-text refusal and log the header that caused it (`detail` is added to the log line only, `quiet`
        sends without logging). Returns True so callers can `return`."""
        if not quiet:
            log.warning("refused %s %s from %s: %s%s", self.command, urlsplit(self.path).path[:80], self.client_address[0], why,
                        f" ({detail})" if detail else "")
        self._send(code, (why + "\n").encode(), headers=headers, head=head)
        return True

    def _refuse_ingest(self, code, why, detail, headers=None):
        """A refused push: logged like any refusal, but at most once per address per 10 minutes."""
        held = note_refusal(self.client_address[0], code, why)
        if held:
            detail += f"; {held} more refused from this address since the last line"
        return self._refuse(code, why, headers=headers, detail=detail, quiet=held is None)

    def _host_ok(self, head=False):
        """False after answering 403 when the Host header is not one of this host's names."""
        why = hostinfo.host_refusal(self.headers, config.get(), self.server.server_address[0])
        return not (why and self._refuse(403, why, head))

    def _send(self, code, body=b"", ctype="text/plain; charset=utf-8", headers=None, head=False):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if not head and body:
            self.wfile.write(body)

    # -- profiles: each has a URL path, a redaction level and an optional read token ------------
    def _route(self, path):
        """-> (profile name, path inside the profile), a redirect target, or None."""
        profiles = config.get()["profiles"]
        allowed = [n for n in (self.server.profiles or list(profiles)) if n in profiles]
        by_len = sorted(allowed, key=lambda n: len(profiles[n]["path"].rstrip("/")), reverse=True)
        for name in by_len:
            base = profiles[name]["path"].rstrip("/")
            if base and path == base:
                return ("redirect", base + "/")
            if base and path.startswith(base + "/"):
                return (name, path[len(base):])
        for name in by_len:  # the root profile takes whatever is left
            if profiles[name]["path"].rstrip("/") == "":
                return (name, path)
        if len(allowed) == 1:  # a listener with one profile also serves it at /
            return (allowed[0], path)
        return None

    def _authorised(self, name, parts):
        """True, or an (code, headers) refusal/redirect to send instead."""
        want = read_token_hash(name)
        if not want:
            return True
        qs = parse_qs(parts.query)
        given = (qs.get("key") or [None])[0]
        via_query = given is not None
        if given is None:
            given = _cookie_value(self.headers.get("Cookie"), f"weatherdeck_{name}")
        if given is None:
            auth = self.headers.get("Authorization") or ""
            given = auth[7:].strip() if auth.lower().startswith("bearer ") else None
        if given and hmac.compare_digest(hashlib.sha256(given.encode()).hexdigest(), want):
            if via_query:  # remember it in a cookie and drop it from the address bar
                rest = {k: v for k, v in qs.items() if k != "key"}
                where = parts.path + (("?" + urlencode(rest, doseq=True)) if rest else "")
                return (302, {"Location": where, "Set-Cookie": f"weatherdeck_{name}={given}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000"})
            return True
        return (401, {})

    def _static(self, name, head):
        path = config.WEB / name
        try:
            data = path.read_bytes()
        except OSError:
            return self._send(404, b"not found\n", head=head)
        etag = '"' + hashlib.sha1(data).hexdigest()[:16] + '"'
        if self.headers.get("If-None-Match") == etag:
            return self._send(304, headers={"ETag": etag, "Cache-Control": "no-cache"}, head=True)
        ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self._send(200, data, ctype, {"ETag": etag, "Cache-Control": "no-cache"}, head)

    def _theme_file(self, sub, head):
        """/themes/<id>/<path>: only .json .woff2 .js .txt, resolved inside that theme's folder."""
        parts = sub.split("/")[2:]
        base = themes.root()
        if len(parts) < 2 or not themes.ID_RE.match(parts[0]) or any(p in ("", ".", "..") for p in parts[1:]):
            return self._send(404, b"not found\n", head=head)
        try:
            folder = (base / parts[0]).resolve()
            path = folder.joinpath(*parts[1:]).resolve()
            if path.suffix not in themes.SERVED or folder not in path.parents or base.resolve() not in folder.parents:
                raise OSError
            data = path.read_bytes()
        except OSError:
            return self._send(404, b"not found\n", head=head)
        etag = '"' + hashlib.sha1(data).hexdigest()[:16] + '"'
        if self.headers.get("If-None-Match") == etag:
            return self._send(304, headers={"ETag": etag, "Cache-Control": "no-cache"}, head=True)
        ctype = {".json": "application/json", ".woff2": "font/woff2", ".js": "text/javascript; charset=utf-8",
                 ".txt": "text/plain; charset=utf-8"}[path.suffix]
        self._send(200, data, ctype, {"ETag": etag, "Cache-Control": "no-cache"}, head)

    def _logo(self, head):
        logo = config.get()["theme"].get("logo")
        base = config.data_dir()
        try:
            path = (base / logo).resolve()
            if not logo or base.resolve() not in path.parents:
                raise OSError
            data = path.read_bytes()
        except OSError:
            return self._send(404, b"no logo\n", head=head)
        self._send(200, data, mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                   {"Cache-Control": "no-cache"}, head)

    def _api_view(self, profile, head):
        body, gz, etag = view_body(profile)
        if self.headers.get("If-None-Match") == etag:
            return self._send(304, headers={"ETag": etag, "Cache-Control": "no-store"}, head=True)
        headers = {"ETag": etag, "Cache-Control": "no-store", "Vary": "Accept-Encoding, Cookie"}
        if "gzip" in (self.headers.get("Accept-Encoding") or ""):
            headers["Content-Encoding"] = "gzip"
            body = gz
        self._send(200, body, "application/json", headers, head)

    def _json(self, doc, head):
        self._send(200, json.dumps(doc, separators=(",", ":")).encode(), "application/json", {"Cache-Control": "no-store", "Vary": "Cookie"}, head)

    def _api_log(self, profile, query, head):
        """The Logbook: the newest lines of the received log, what each push from each source counted and showed.
        Guest and public views get the counts only; a public view also loses rejection reasons."""
        redaction, _ = effective_redaction(config.get()["profiles"][profile])
        try:
            n = int((query.get("n") or ["40"])[0])
        except ValueError:
            n = 40
        lines = ingest.received_tail(n)
        for d in lines:
            d.pop("client", None)  # a pusher's address is for the host's own log and `weatherdeck received`, never a page
        if redaction in ("guest", "public"):
            for d in lines:
                d.pop("shown", None)
                d.pop("titles", None)
                if redaction == "public" and d.get("reason"):
                    d["reason"] = "rejected"
        self._json({"lines": lines, "now": time.time()}, head)

    def _api_history(self, profile, query, head):
        """One item's events, newest first: what the host derived from successive feeds (started, waiting, finished, ...).
        Item ids are opaque in guest and public views, so those get none."""
        redaction, _ = effective_redaction(config.get()["profiles"][profile])
        item = (query.get("item") or [""])[0][:200]
        owner = (query.get("owner") or [None])[0]
        rows = []
        if item and redaction in ("none", "household"):
            conn = store.connect()
            try:
                modes = {r["mode"] for r in conn.execute("SELECT mode FROM sources")}
                sample = 1 if modes and modes <= {"sample"} else 0
                sql = "SELECT at, owner, item, grp, kind, text FROM events WHERE item = ? AND sample = ?" + (" AND owner = ?" if owner else "")
                args = (item, sample, owner) if owner else (item, sample)
                rows = [{"at": r["at"], "owner": r["owner"], "item": r["item"], "group": r["grp"], "kind": r["kind"], "text": r["text"]}
                        for r in conn.execute(sql + " ORDER BY at DESC LIMIT 50", args)]
            finally:
                conn.close()
        self._json({"item": item, "events": rows, "now": time.time()}, head)

    def _healthz(self, head):
        self._send(200, json.dumps({"ok": True, "version": ui_version(), "package": package_version(), "now": time.time(), "instance": INSTANCE}).encode(),
                   "application/json", {"Cache-Control": "no-store"}, head)

    def _get(self, head):
        parts = urlsplit(self.path)
        if not self._host_ok(head):
            return
        try:
            if parts.path == "/healthz":
                return self._healthz(head)
            routed = self._route(parts.path)
            if routed is None:
                return self._send(404, b"not found\n", head=head)
            if routed[0] == "redirect":
                return self._send(301, headers={"Location": routed[1]}, head=True)
            name, sub = routed
            auth = self._authorised(name, parts)
            if auth is not True:
                code, headers = auth
                if code == 401:
                    return self._send(401, b"This view needs a read token. Open it once as ?key=<token>.\n", headers={"WWW-Authenticate": "Bearer"}, head=head)
                return self._send(code, headers=headers, head=True)
            if sub in STATIC:
                return self._static(STATIC[sub], head)
            if sub == "/logo":
                return self._logo(head)
            if sub.startswith("/themes/"):
                return self._theme_file(sub, head)
            if sub == "/api/view":
                return self._api_view(name, head)
            if sub == "/api/log":
                return self._api_log(name, parse_qs(parts.query), head)
            if sub == "/api/history":
                return self._api_history(name, parse_qs(parts.query), head)
            if sub == "/healthz":
                return self._healthz(head)
            return self._send(404, b"not found\n", head=head)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            raise
        except Exception:
            log.exception("GET %s failed", parts.path)
            self._send(500, b"internal error\n", head=head)

    def do_GET(self):
        self._get(False)

    def do_HEAD(self):
        self._get(True)

    def do_POST(self):
        if not self._host_ok():
            return
        if urlsplit(self.path).path != "/api/ingest":
            return self._send(404, b"not found\n")
        why = hostinfo.origin_refusal(self.headers)
        if why:
            return self._refuse(403, why)
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            return self._refuse(415, f"Content-Type {ctype[:40]!r} is not accepted: send the feed as application/json")
        try:
            bound = None
            if load_tokens():
                auth = self.headers.get("Authorization")
                bound = token_source(auth)
                if bound is None:
                    what = "the bearer token is not one this host holds"
                    if not auth:
                        what = "no Authorization header"
                    elif not auth.lower().startswith("bearer "):
                        what = "the Authorization header is not a bearer token"
                    return self._refuse_ingest(401, "a valid bearer token is required", what, {"WWW-Authenticate": "Bearer"})
                expired = join.invite_refusal(bound)
                if expired:
                    return self._refuse_ingest(401, expired, f"the invite for {bound} expired before a first push", {"WWW-Authenticate": "Bearer"})
            elif not ipaddress.ip_address(self.client_address[0]).is_loopback:
                return self._refuse_ingest(403, "no tokens exist yet: only local callers may push; run 'weatherdeck token new <source-id>'",
                                           "this host has no tokens, and this address is not loopback")
            length = self.headers.get("Content-Length")
            if length is None or not length.isdigit():
                return self._send(411, b"Content-Length is required\n")
            if int(length) > MAX_BODY:
                return self._send(413, b"payload too large\n")
            body = self.rfile.read(int(length))
            res = ingest.ingest(body, transport="http", pin_source=bound, client=self.client_address[0])
            code = {ingest.OK: 200, ingest.REJECTED: 422}.get(res.code, 500)
            if code == 200 and bound:
                try:
                    join.mark_joined(bound)
                except Exception:
                    log.exception("could not note the first push of %s in the invite registry", bound)
            if code == 422 and res.text.startswith("rejected: replay"):
                code = 409
            self._send(code, (res.text + "\n").encode())
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            raise
        except Exception:
            log.exception("POST failed")
            self._send(500, b"internal error\n")

    def _no(self):
        if not self._host_ok():
            return
        self._send(405, b"read-only: GET and HEAD, plus POST /api/ingest\n", headers={"Allow": "GET, HEAD, POST"})

    do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _no


class Listener(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = not osx.IS_WIN  # on Windows SO_REUSEADDR would let another process share the port
    request_queue_size = 32
    profiles = None  # None: serves every profile

    def server_bind(self):
        # The stdlib's version also resolves the bound address back to a name (getfqdn), which can stall
        # for tens of seconds on a runner with no reverse DNS; nothing here uses that name.
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


class Host:
    """Binds every wanted address; rechecks `auto:` ranges until their address appears."""

    def __init__(self, entries, port):
        self.port, self.entries = port, list(entries)
        self.listeners = {}
        self.stop = threading.Event()
        self.lock = threading.Lock()

    def _names(self):
        return list(config.get()["profiles"])

    def _bind(self, addr, profiles):
        srv = Listener((addr, self.port), Handler)
        srv.profiles = profiles
        threading.Thread(target=srv.serve_forever, name=f"listen-{addr}", daemon=True).start()
        self.listeners[addr] = srv
        log.info("listening on http://%s:%d/ serving %s", addr, self.port, profiles or "every profile")

    def urls(self):
        return [f"http://{a}:{self.port}/" for a in self.listeners]

    def start(self):
        addrs, waiting = hostinfo.resolve(self.entries, self._names())
        with self.lock:
            for a, profiles in addrs.items():
                self._bind(a, profiles)  # a bind failure here (port in use) is fatal and reported by the caller
        if waiting:
            threading.Thread(target=self._watch, name="rebind", daemon=True).start()

    def _watch(self):
        while not self.stop.wait(15):
            try:
                addrs, _ = hostinfo.resolve(self.entries, self._names())
                with self.lock:
                    new = [a for a in addrs if a not in self.listeners]
                    for a in new:
                        self._bind(a, addrs[a])
                if new:
                    write_state(self)
            except Exception:
                log.exception("rechecking addresses failed")

    def shutdown(self):
        self.stop.set()
        with self.lock:
            for srv in self.listeners.values():
                srv.shutdown()
                srv.server_close()


def state_path():
    return config.data_dir() / "server.json"


def stop_path():
    return config.data_dir() / "stop.request"


def write_state(host):
    import os
    store.write_json_atomic(state_path(), {
        "pid": os.getpid(), "instance": INSTANCE, "started": time.time(), "urls": host.urls(),
        "listeners": {a: (p or "all") for a, p in ((a, s.profiles) for a, s in host.listeners.items())},
        "data_dir": str(config.data_dir()), "version": ui_version()})


def serve(port=None, bind=None, on_ready=None):
    """Run until a stop signal or a stop.request file appears. Returns the process exit code."""
    cfg = config.get()
    config.setup_logging("server")
    entries = bind or cfg["hosts"]["bind"]
    hostinfo.resolve(entries, list(cfg["profiles"]))  # fail early on a refused address or unknown profile
    host = Host(entries, port or cfg["hosts"]["port"])
    done = threading.Event()
    for sig in osx.termination_signals():
        try:
            signal.signal(sig, lambda *_: done.set())
        except (ValueError, OSError):
            pass
    try:
        stop_path().unlink()
    except FileNotFoundError:
        pass
    try:
        host.start()
    except OSError as exc:
        log.error("cannot listen on port %s: %s", host.port, exc)
        print(f"weatherdeck: cannot listen on port {host.port}: {exc}", flush=True)
        return 1
    write_state(host)
    print("weatherdeck: serving " + (", ".join(host.urls()) or "(waiting for a configured address)"), flush=True)
    if on_ready:
        on_ready(host)
    while not done.wait(1):  # `weatherdeck off` asks politely with a file, which works the same on every platform
        if stop_path().exists():
            break
    host.shutdown()
    for p in (state_path(), stop_path()):
        try:
            p.unlink()
        except FileNotFoundError:
            pass
    log.info("stopped")
    return 0
