"""The one ingest path, shared by every transport (HTTP POST, forced-command stdin, local pipe).

ingest() validates, checks the sequence, stores the feed atomically, and appends history. It
never raises: a bad payload returns code 65 and is logged, an internal fault returns 70.
"""
import calendar
import hashlib
import ipaddress
import json
import logging
import os
import time
from dataclasses import dataclass

from . import config, debounce, ledgerwriter, norms, schema, store

log = logging.getLogger("weatherdeck.ingest")

OK, REJECTED, FAULT = 0, 65, 70


@dataclass
class Result:
    code: int
    text: str
    source_id: str = None

    @property
    def ok(self):
        return self.code == OK


def norm_id(owner, item_id):
    """Relayed copies may carry the owner as a prefix ('owner/id'); treat both spellings as one."""
    prefix = f"{owner}/"
    return item_id[len(prefix):] if owner and item_id.startswith(prefix) else item_id


def _iso(epoch):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch))


def _scrub(text, limit=200):
    return "".join(c if c.isprintable() else " " for c in str(text))[:limit]


# ---- the received log: one JSON line per push, accepted or not ---------------------------------
# What each source sent and what the board then had from it: counts per section, and the exact titles whenever they
# changed since that source's previous feed (a keepalive repeats nothing). Rotated at history.received_log_kb, keeping
# history.received_log_keep older files. Read it with `weatherdeck received`.
def received_log_path():
    return config.data_dir() / "received-log.jsonl"


def feed_counts(feed):
    att, items = feed.get("attention") or [], feed.get("items") or []
    return {"wait_on_you": sum(1 for a in att if a.get("severity") not in ("critical", "info")),
            "critical": sum(1 for a in att if a.get("severity") == "critical"),
            "info": sum(1 for a in att if a.get("severity") == "info"),
            "items": len(items), "running": sum(1 for i in items if i.get("state") == "running"),
            "waiting": sum(1 for i in items if i.get("state") == "waiting"),
            "failed": sum(1 for i in items if i.get("state") == "failed"),
            "next": len(feed.get("next") or []), "done": len(feed.get("done") or []), "machines": len(feed.get("machines") or [])}


def _lane_word(item):
    step = ((item.get("progress") or {}).get("current") or {}).get("step")
    return f"{item.get('state')} at {step}" if step else item.get("state")


def feed_titles(feed):
    att = feed.get("attention") or []
    return {"wait_on_you": [a.get("title") or a["id"] for a in att if a.get("severity") not in ("critical", "info")],
            "critical": [a.get("title") or a["id"] for a in att if a.get("severity") == "critical"],
            "items": [[i.get("title") or i["id"], _lane_word(i)] for i in feed.get("items") or []],
            "next": [n.get("title") or n["id"] for n in feed.get("next") or []],
            "done": [d.get("title") or d["id"] for d in feed.get("done") or []],
            "info": [a.get("title") or a["id"] for a in att if a.get("severity") == "info"]}


def _titles_digest(feed):
    return hashlib.sha1(json.dumps(feed_titles(feed), sort_keys=True).encode()).hexdigest()[:16] if feed else None


_tail_cache = {}


def loopback_http_sources(now=None, within_s=86400):
    """Source ids the received log shows pushing over HTTP from a loopback address within `within_s` of now, sorted.
    A line written before the log recorded `client` names no address and is never counted as loopback."""
    now = now if now is not None else time.time()
    path = received_log_path()
    keep = max(1, int(config.get()["history"].get("received_log_keep", 3)))
    seen = set()
    for p in [path.with_name(f"{path.name}.{i}") for i in range(keep, 0, -1)] + [path]:
        try:
            with open(p, encoding="utf-8", errors="replace") as fh:
                for raw in fh:
                    try:
                        d = json.loads(raw)
                        at = calendar.timegm(time.strptime(d["at"], "%Y-%m-%dT%H:%M:%SZ"))
                        loop = d.get("transport") == "http" and ipaddress.ip_address(d.get("client")).is_loopback
                    except (ValueError, TypeError, KeyError):
                        continue
                    if loop and d.get("source") and now - within_s <= at <= now + 60:
                        seen.add(d["source"])
        except OSError:
            continue
    return sorted(seen)


def received_tail(n=40):
    """The newest n lines of the received log, oldest first, each ok line with the titles its source showed then
    (`titles`, carried from that source's last line that listed them; None when that was before the log's window).
    Parsed again only when a log file changed."""
    path = received_log_path()
    keep = max(1, int(config.get()["history"].get("received_log_keep", 3)))
    files = [path.with_name(f"{path.name}.{i}") for i in range(keep, 0, -1)] + [path]
    sig = []
    for p in files:
        try:
            st = p.stat()
            sig.append((str(p), st.st_mtime_ns, st.st_size))
        except OSError:
            continue
    if _tail_cache.get("sig") != sig:
        lines = []
        for p, _, _ in sig[-2:]:  # the current file and the one before it are plenty for a page's worth
            try:
                with open(p, encoding="utf-8", errors="replace") as fh:
                    for raw in fh:
                        try:
                            d = json.loads(raw)
                        except ValueError:
                            continue
                        if isinstance(d, dict):
                            lines.append(d)
            except OSError:
                continue
        shown = {}
        for d in lines:
            if d.get("result") == "ok":
                if isinstance(d.get("shown"), dict):
                    shown[d.get("source")] = d["shown"]
                d["titles"] = shown.get(d.get("source"))
        _tail_cache.update(sig=sig, lines=lines[-200:])
    return [dict(d) for d in _tail_cache["lines"][-max(1, min(200, n)):]]


def log_received(line):
    """Append one line to the received log; a full disk or a locked file never fails an ingest."""
    try:
        hist = config.get()["history"]
        path, keep = received_log_path(), max(1, int(hist.get("received_log_keep", 3)))
        if path.exists() and path.stat().st_size >= max(16, int(hist.get("received_log_kb", 2048))) * 1024:
            for i in range(keep, 0, -1):
                src = path if i == 1 else path.with_name(f"{path.name}.{i - 1}")
                if src.exists():
                    os.replace(src, path.with_name(f"{path.name}.{i}"))
        fd = os.open(str(path), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(line, separators=(",", ":"), ensure_ascii=False) + "\n")
    except (OSError, ValueError, TypeError):
        log.exception("cannot write the received log")


def _record_reject(conn, sid, received_at, reason, kind, size, boot_id=None, seq=None, transport=None, client=None):
    path = store.rejected_dir() / f"{sid or '_unknown'}.json"
    prev = store.read_json(path, {}) or {}
    store.write_json_atomic(path, {
        "since": prev.get("since", received_at), "last_at": received_at, "count": prev.get("count", 0) + 1,
        "reason": reason, "kind": kind, "seq": seq, "boot_id": boot_id,
    })
    conn.execute("INSERT INTO pushes(source_id, received_at, boot_id, seq, status, reason, bytes) VALUES(?,?,?,?,?,?,?)",
                 (sid, received_at, boot_id, seq, "rejected", reason, size))
    conn.commit()
    line = {"v": 1, "at": _iso(received_at), "source": sid, "transport": transport, "result": "rejected", "reason": reason,
            "kind": kind, "seq": seq, "boot_id": boot_id, "bytes": size}
    if client:
        line["client"] = client
    log_received(line)


def derive_events(prev, feed, sid):
    """History from successive feeds: what appeared, changed state, finished, needs attention."""
    out = []
    pmap = {}
    for it in (prev or {}).get("items", []):
        owner = it.get("owner") or prev["source"]["id"]
        pmap[(owner, norm_id(owner, it["id"]))] = it
    for it in feed["items"]:
        owner = it.get("owner") or sid
        key = (owner, norm_id(owner, it["id"]))
        title = it.get("title") or it["id"]
        grp = it.get("group")
        old = pmap.get(key)
        if prev is None:
            continue
        if old is None:
            out.append(("started", owner, key[1], grp, title))
            continue
        state, ostate = it.get("state"), old.get("state")
        hand, ohand = (it.get("handoff") or {}).get("state"), (old.get("handoff") or {}).get("state")
        if hand == "awaiting_you" and ohand != "awaiting_you":
            out.append(("approval", owner, key[1], grp, title))
        elif state != ostate:
            kind = {"waiting": "waiting", "done": "finished", "failed": "failed", "blocked": "failed"}.get(state, "update")
            out.append((kind, owner, key[1], grp, title))
    if prev is not None:
        seen = {a["id"] for a in prev.get("attention", [])}
        for a in feed["attention"]:
            if a["id"] not in seen and a.get("severity") in ("critical", "action"):
                out.append(("alert", sid, a.get("item"), a.get("group"), a.get("title") or a["id"]))
    return out


def _insert_event(conn, sid, at, owner, item, grp, kind, text, sample):
    dup = conn.execute("SELECT 1 FROM events WHERE owner IS ? AND item IS ? AND kind=? AND ABS(at-?)<120",
                       (owner, item, kind, at)).fetchone()
    if not dup:
        conn.execute("INSERT INTO events(source_id, at, owner, item, grp, kind, text, sample) VALUES(?,?,?,?,?,?,?,?)",
                     (sid, at, owner, item, grp, kind, text, sample))


def _record_history(conn, sid, feed, prev, received_at, sample, restarted):
    for kind, owner, item, grp, text in derive_events(prev, feed, sid):
        _insert_event(conn, sid, received_at, owner, item, grp, kind, text, sample)
    if restarted:
        _insert_event(conn, sid, received_at, sid, None, None, "restart", feed["source"].get("label") or sid, sample)
    for d in feed["done"]:
        owner = d.get("owner") or sid
        key = f"{owner}/{norm_id(owner, d['id'])}"
        at = schema.parse_time(d["at"])
        if conn.execute("SELECT 1 FROM done WHERE key=? AND ABS(at-?)<86400", (key, at)).fetchone():
            continue
        conn.execute("INSERT INTO done(key, owner, grp, title, via, at, source_id, sample) VALUES(?,?,?,?,?,?,?,?)",
                     (key, owner, d.get("group"), d.get("title"), d.get("via"), at, sid, sample))
        _insert_event(conn, sid, at, owner, norm_id(owner, d["id"]), d.get("group"), "completed", d.get("title") or d["id"], sample)
    for e in feed["events"]:
        _insert_event(conn, sid, float(e["at"]), sid, e.get("item"), None, e.get("kind") or "update", e.get("text") or "", sample)


def _record_norms(conn, feed, received_at):
    """Each machine row's load per core, folded into that machine's norm (norms.py). A row is keyed by the machine and,
    for the source's own machine, its station, so a Windows host and its Linux guest keep separate norms."""
    from .view import machine_aliases
    cfg = config.get()
    aliases = machine_aliases(cfg)
    have = {}
    for r in conn.execute("SELECT key, state FROM machine_norms"):
        try:
            have[r["key"]] = json.loads(r["state"])
        except ValueError:
            pass
    src = feed["source"]
    for m in feed["machines"]:
        value = norms.load_per_core(m)
        if value is None:
            continue
        mid = aliases[m["id"]][0] if m["id"] in aliases else m["id"]
        station = (aliases[m["id"]][1] if m["id"] in aliases else src.get("station") if src.get("machine") == m["id"] else None) or ""
        key = "%s|%s" % (mid, station)
        at = received_at - ((m.get("beat") or {}).get("age_s") or 0)
        store.save_norm(conn, key, mid, norms.step(have.get(key), value, at, cfg["health"]))


def _record_alerts(conn, feed):
    """Fold this feed into each of its source's machine alerts (debounce.py): one more feed with the alert, or one more
    without it. A critical, a service and a supervision card are never kept: they are not debounced."""
    sid = feed["source"]["id"]
    now = {str(a.get("id")): a for a in feed.get("attention") or [] if debounce.is_machine_alert(a)}
    have = store.alerts(conn).get(sid, {})
    for aid in sorted(set(now) | set(have)):
        store.save_alert(conn, sid, aid, debounce.step(have.get(aid), now.get(aid)))


def ingest(raw, transport="stdin", pin_source=None, received_at=None, client=None):
    """Accept one feed document. received_at is only ever passed by the demo replay; client is the pusher's network
    address, passed by the HTTP host only, and is written to the received log (never to a view)."""
    received_at = received_at if received_at is not None else time.time()
    try:
        return _ingest(raw, transport, pin_source, received_at, client)
    except schema.Reject as exc:  # raised before the lock for pin mismatches
        log.warning("rejected (%s): %s", transport, exc.reason)
        return Result(REJECTED, f"rejected: {exc.reason}")
    except Exception:
        log.exception("ingest fault (%s)", transport)
        return Result(FAULT, "error: internal fault, see ingest.log")


def _ingest(raw, transport, pin_source, received_at, client=None):
    conn = store.connect()
    try:
        limit = config.get()["limits"]["max_payload_bytes"]
        sid = boot_id = seq = None
        try:
            if len(raw) > limit:
                raise schema.Reject(f"payload is {len(raw)} bytes, the limit is {limit}", "size")
            try:
                doc = json.loads(raw.decode("utf-8"))
            except (ValueError, UnicodeDecodeError, RecursionError):
                raise schema.Reject("the body is not valid JSON", "json")
            if isinstance(doc, dict) and isinstance(doc.get("source"), dict) and isinstance(doc["source"].get("id"), str):
                sid = _scrub(doc["source"]["id"], 48) if schema.ID_RE.match(doc["source"]["id"]) else None
            feed, warnings = schema.validate(doc)
            sid = feed["source"]["id"]
            boot_id, seq = feed["producer"].get("boot_id"), feed["producer"].get("seq")
            if pin_source and sid != pin_source:
                raise schema.Reject(f"source id {sid!r} does not match the credential's source {pin_source!r}", "source")
            with store.ingest_lock():
                res = _store(conn, feed, warnings, len(raw), received_at, transport, client)
            ledgerwriter.tick(conn, received_at)
            return res
        except schema.Reject as exc:
            reason = _scrub(exc.reason)
            with store.ingest_lock():
                _record_reject(conn, sid, received_at, reason, exc.kind, len(raw), boot_id, seq, transport, client)
            log.warning("rejected (%s) source=%s: %s", transport, sid, reason)
            return Result(REJECTED, f"rejected: {reason}", sid)
    finally:
        conn.close()


def _store(conn, feed, warnings, size, received_at, transport=None, client=None):
    sid = feed["source"]["id"]
    prod = feed["producer"]
    boot_id, seq = prod.get("boot_id"), prod.get("seq")
    row = conn.execute("SELECT * FROM sources WHERE id=?", (sid,)).fetchone()

    if feed["source"].get("retired"):
        store.forget_source(conn, sid)
        log.info("source %s retired itself", sid)
        return Result(OK, f"ok retired source={sid}", sid)

    if row is None:
        count = conn.execute("SELECT COUNT(*) FROM sources").fetchone()[0]
        if count >= config.get()["limits"]["max_sources"]:
            raise schema.Reject(f"too many sources (limit {config.get()['limits']['max_sources']})", "limit")

    gap, restarted = 0, False
    if row is not None and seq is not None and boot_id is not None:
        if row["boot_id"] == boot_id and row["last_seq"] is not None:
            if seq <= row["last_seq"]:
                raise schema.Reject(f"replay: seq {seq} is not above the last accepted {row['last_seq']}", "replay")
            gap = seq - row["last_seq"] - 1
        elif row["boot_id"] is not None and row["boot_id"] != boot_id:
            restarted = True

    prev_doc = store.read_json(store.sources_dir() / f"{sid}.json", {}) or {}
    prev = prev_doc.get("feed")
    sample = 1 if prod.get("mode") == "sample" else 0
    src = feed["source"]
    interval = feed.get("interval_s") or config.get()["thresholds"]["default_interval_s"]
    conn.execute(
        "INSERT INTO sources(id,label,machine,kind,peers,first_seen,last_received,boot_id,last_seq,interval_s,mode)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label, machine=excluded.machine,"
        " kind=excluded.kind, peers=excluded.peers, last_received=excluded.last_received, boot_id=excluded.boot_id,"
        " last_seq=excluded.last_seq, interval_s=excluded.interval_s, mode=excluded.mode",
        (sid, src.get("label"), src.get("machine"), src.get("kind"), json.dumps(src.get("peers") or []),
         received_at, received_at, boot_id, seq, interval, prod.get("mode")))
    conn.execute("INSERT INTO pushes(source_id, received_at, boot_id, seq, status, bytes, gap, mode) VALUES(?,?,?,?,?,?,?,?)",
                 (sid, received_at, boot_id, seq, "ok", size, gap, prod.get("mode")))
    _record_history(conn, sid, feed, prev, received_at, sample, restarted)
    _record_norms(conn, feed, received_at)
    _record_alerts(conn, feed)
    # Published last, once everything derived from the feed has worked: a fault above leaves the last good file and rolls the database back.
    store.write_json_atomic(store.sources_dir() / f"{sid}.json", {"received_at": received_at, "feed": feed})
    conn.commit()
    try:
        (store.rejected_dir() / f"{sid}.json").unlink()
    except FileNotFoundError:
        pass
    store.prune(conn, received_at)
    if warnings:
        log.info("source %s: %s", sid, "; ".join(warnings[:5]))
    digest = _titles_digest(feed)
    line = {"v": 1, "at": _iso(received_at), "source": sid, "transport": transport, "result": "ok", "seq": seq, "boot_id": boot_id,
            "bytes": size, "gap": gap, "mode": prod.get("mode"), "adapter": prod.get("version"), "restarted": restarted or None,
            "generated_at": feed.get("generated_at"), "counts": feed_counts(feed), "digest": digest}
    if digest != _titles_digest(prev):
        line["shown"] = feed_titles(feed)
    if client:
        line["client"] = client
    log_received(line)
    return Result(OK, (f"ok seq={seq} " if seq is not None else "ok ") + f"received_at={_iso(received_at)}", sid)
