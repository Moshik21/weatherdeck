"""Storage in the data dir.

  sources/<id>.json    last accepted feed per source, wrapped with its receive time
  rejected/<id>.json   why the newest push from that source was refused (cleared on accept)
  history.sqlite       sources, pushes, events, done, machine_norms, machine_alerts (0600, WAL)
  tokens.json          sha256 of per-source bearer tokens (0600)

Files are written to a temporary name, fsynced and renamed, so a reader never sees half a file.
"""
import json
import os
import sqlite3
import tempfile
import time
from contextlib import contextmanager

from . import config, osx

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS sources(
  id TEXT PRIMARY KEY, label TEXT, machine TEXT, kind TEXT, peers TEXT,
  first_seen REAL, last_received REAL, boot_id TEXT, last_seq INTEGER, interval_s INTEGER, mode TEXT);
CREATE TABLE IF NOT EXISTS pushes(
  id INTEGER PRIMARY KEY, source_id TEXT, received_at REAL, boot_id TEXT, seq INTEGER,
  status TEXT, reason TEXT, bytes INTEGER, gap INTEGER DEFAULT 0, mode TEXT);
CREATE INDEX IF NOT EXISTS pushes_at ON pushes(received_at);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY, source_id TEXT, at REAL, owner TEXT, item TEXT, grp TEXT,
  kind TEXT, text TEXT, sample INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS events_at ON events(at);
CREATE TABLE IF NOT EXISTS done(
  id INTEGER PRIMARY KEY, key TEXT, owner TEXT, grp TEXT, title TEXT, via TEXT,
  at REAL, source_id TEXT, sample INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS done_key ON done(key);
CREATE INDEX IF NOT EXISTS done_at ON done(at);
CREATE TABLE IF NOT EXISTS machine_norms(key TEXT PRIMARY KEY, machine TEXT, state TEXT);
CREATE TABLE IF NOT EXISTS machine_alerts(source_id TEXT, alert_id TEXT, state TEXT, PRIMARY KEY(source_id, alert_id));
"""


def sources_dir():
    d = config.data_dir() / "sources"
    d.mkdir(mode=0o700, exist_ok=True)
    return d


def rejected_dir():
    d = config.data_dir() / "rejected"
    d.mkdir(mode=0o700, exist_ok=True)
    return d


def write_json_atomic(path, doc):
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, 0o600)
        osx.replace_file(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def read_json(path, default=None):
    for attempt in range(5):
        try:
            with open(path, encoding="utf-8") as fh:
                return json.load(fh)
        except FileNotFoundError:
            return default
        except PermissionError:  # Windows: the writer is replacing the file right now
            time.sleep(0.03)
        except ValueError:
            return default
    return default


def connect():
    path = config.data_dir() / "history.sqlite"
    old = os.umask(0o077)
    try:
        conn = sqlite3.connect(str(path), timeout=10)
    finally:
        os.umask(old)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=8000")
    conn.executescript(SCHEMA_SQL)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return conn


@contextmanager
def ingest_lock():
    """Serialise ingests so the seq check and the write are one step."""
    with osx.file_lock(config.data_dir() / "ingest.lock"):
        yield


def load_source_feeds():
    """{source id: {"received_at": epoch, "feed": doc}} for every stored source."""
    out = {}
    for path in sorted(sources_dir().glob("*.json")):
        doc = read_json(path)
        if isinstance(doc, dict) and isinstance(doc.get("feed"), dict):
            out[path.stem] = doc
    return out


def forget_source(conn, source_id):
    for p in (sources_dir() / f"{source_id}.json", rejected_dir() / f"{source_id}.json"):
        try:
            p.unlink()
        except FileNotFoundError:
            pass
    conn.execute("DELETE FROM sources WHERE id=?", (source_id,))
    conn.execute("DELETE FROM machine_alerts WHERE source_id=?", (source_id,))
    conn.commit()


def prune(conn, now=None):
    """Events and pushes after events_days; done rows lose their titles then and go after rollup_days."""
    now = now or time.time()
    last = float((conn.execute("SELECT v FROM meta WHERE k='pruned'").fetchone() or [0])[0] or 0)
    if now - last < 3600:
        return
    h = config.get()["history"]
    conn.execute("DELETE FROM events WHERE at < ?", (now - h["events_days"] * 86400,))
    conn.execute("DELETE FROM pushes WHERE received_at < ?", (now - h["events_days"] * 86400,))
    conn.execute("UPDATE done SET title=NULL WHERE at < ? AND title IS NOT NULL", (now - h["events_days"] * 86400,))
    conn.execute("DELETE FROM done WHERE at < ?", (now - h["rollup_days"] * 86400,))
    conn.execute("INSERT OR REPLACE INTO meta(k,v) VALUES('pruned', ?)", (str(now),))
    conn.commit()


def norms(conn):
    """{machine id: [state, ...]}: each station's load norm (norms.py), kept between restarts."""
    out = {}
    for r in conn.execute("SELECT machine, state FROM machine_norms"):
        try:
            out.setdefault(r["machine"], []).append(json.loads(r["state"]))
        except ValueError:
            pass
    return out


def save_norm(conn, key, machine, state):
    conn.execute("INSERT OR REPLACE INTO machine_norms(key, machine, state) VALUES(?,?,?)", (key, machine, json.dumps(state)))


def alerts(conn):
    """{source id: {alert id: state}}: each machine alert's debounce state (debounce.py), kept between restarts."""
    out = {}
    for r in conn.execute("SELECT source_id, alert_id, state FROM machine_alerts"):
        try:
            out.setdefault(r["source_id"], {})[r["alert_id"]] = json.loads(r["state"])
        except ValueError:
            pass
    return out


def save_alert(conn, source_id, alert_id, state):
    """Keep an alert's state, or forget it when state is None (it has cleared)."""
    if state is None:
        conn.execute("DELETE FROM machine_alerts WHERE source_id=? AND alert_id=?", (source_id, alert_id))
    else:
        conn.execute("INSERT OR REPLACE INTO machine_alerts(source_id, alert_id, state) VALUES(?,?,?)", (source_id, alert_id, json.dumps(state)))
