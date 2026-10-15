"""The host's own value ledger: one line per counter, source and closed UTC day, appended to `<ledger dir>/weatherdeck.jsonl`
(docs/ledger-spec.md, docs/ADDINS.md "Writing the ledger").

It reads only what the host already keeps in history.sqlite (`pushes`, `events`, `done`, `sources`), writes nothing else, starts
no process and no thread, and never reads the clock: every time is passed in. A closed day is written once; a line is never
edited, and a ledger the reader cannot read is left exactly as it is and reported, never replaced. Unknown stays unknown: a
counter the host does not record is a line with `value: null`, its reason and, in `needs`, the one field that would make it
measurable. Only counts, opaque keys and record ranges are written, never an id, a title or a path.

    compute(rows, frm, to, ...)   the lines of one day from the rows the host holds (pure)
    write(conn, now, path, ...)   the lines of every closed day not written yet, appended in one atomic step
    run(conn, now, ...)           write with the configured folder, the install's salt and the host label kept from the first write
"""
import contextlib
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import socket
import tempfile

from . import config, ledger, osx, store

log = logging.getLogger("weatherdeck.ledgerwriter")

TOOL = "weatherdeck"
READER = "weatherdeck-ledger-writer/1"
DAY = ledger.DAY
MAX_DAYS = 60                 # the most days one run writes: the host keeps 30 days of pushes and events
TICK_DAYS = 2                 # the most days one push writes: a backlog is spread over the next pushes
GRACE = 300                   # a day is closed this long after it ends, so a push stamped before midnight has landed
SALT_FILE = "ledger.salt"     # in the data directory, never in a ledger or a feed
STATE_FILE = "ledger-writer.json"
SALT_RE = re.compile(r"^[0-9a-f]{64}$")
CANON = "compact JSON per row, keys sorted, in id order, joined by a newline"
HOST_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
SOURCE_PREFIX = "pushes_ok_"  # then 12 hex digits: an opaque key of the source, never its id
KINDS = {"calls_raised": ("approval", "alert"), "surfaced_failed": ("failed",), "restarts": ("restart",)}
FILTERS = {
    "pushes_ok": "status=ok mode!=sample", "pushes_rejected": "status=rejected mode!=sample",
    "feeds_missed": "status=ok mode!=sample gap>0 (sum of gap)",
    "calls_raised": "kind in (approval, alert) sample=0", "surfaced_failed": "kind=failed sample=0",
    "restarts": "kind=restart sample=0", "landed": "sample=0 (one row per work that landed)",
    "silence_episodes": "last accepted push of a source in the sources table, mode!=sample, with no accepted push from it in the "
                        "next thresholds.lost_after_s seconds; counted on the day those seconds ended",
}
TABLE = {"pushes_ok": "pushes", "pushes_rejected": "pushes", "feeds_missed": "pushes", "silence_episodes": "pushes",
         "calls_raised": "events", "surfaced_failed": "events", "restarts": "events", "landed": "done"}
# What the host does not record, and the one field that would make each countable.
NEEDS = {
    "surfaced_cleared": "an events row written when the host itself moves a lane, a source, a machine or a call onto or off a "
                        "condition (kind = the condition, item = the existing id, text = the feed field that caused it)",
    "views": "none that is honest: a request to the board is not a person looking (a hidden page does not poll, a television "
             "left on polls forever); the host keeps no count of reads by design",
    "events_missed": "a record of what a viewer had seen when a condition changed; a viewer's last look stays in that viewer's "
                     "browser and is never sent to the host",
}
NOT_MEASURABLE = ("views", "events_missed")
RECORDED = tuple(TABLE) + ("surfaced_cleared",)
NO_HEARTBEAT = ("the host's own running record (a heartbeat row), so that a day with no push at all can be told from a day "
                "the host was not running")


def canon(row):
    return json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(rows):
    return "sha256:" + hashlib.sha256("\n".join(canon(r) for r in rows).encode("utf-8")).hexdigest()


def _keyed(salt, text):
    return hmac.new(bytes.fromhex(salt), text.encode("utf-8"), hashlib.sha256).hexdigest()


def source_key(source_id, salt):
    """An opaque 12-hex key for a source: stable on this install, not comparable across installs, and it says nothing by
    itself without the install's salt."""
    return _keyed(salt, "weatherdeck-ledger\x1f" + str(source_id))[:12]


def install_salt(folder=None):
    """The install's random salt, created once (mode 600) in the data directory and read from there after."""
    path = os.path.join(str(folder or config.data_dir()), SALT_FILE)
    try:
        with open(path, encoding="ascii") as fh:
            salt = fh.read().strip()
    except FileNotFoundError:
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=SALT_FILE + ".", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="ascii") as fh:
                fh.write(secrets.token_hex(32) + "\n")
                fh.flush()
                os.fsync(fh.fileno())
            os.chmod(tmp, 0o600)
            try:
                os.link(tmp, path)
            except FileExistsError:
                pass
        finally:
            os.unlink(tmp)
        return install_salt(folder)
    if not SALT_RE.match(salt):
        raise ValueError("%s is not a salt this writer made; it is left as it is" % path)
    return salt


def host_label(cfg=None, salt=None, folder=None):
    """The ledger's host: `ledger.host` when set, else an opaque label from the machine's name and the install's salt (never
    the name itself). run() keeps the label of the first write; this is only the label a first write would use."""
    name = (cfg if cfg is not None else config.get().get("ledger") or {}).get("host")
    if isinstance(name, str) and HOST_RE.match(name):
        return name
    return "h" + _keyed(salt or install_salt(folder), "weatherdeck-host\x1f" + socket.gethostname())[:10]


def kept_host(folder=None):
    """The host label recorded on the first write, or None."""
    doc = store.read_json(os.path.join(str(folder or config.data_dir()), STATE_FILE), {})
    name = doc.get("host") if isinstance(doc, dict) else None
    return name if isinstance(name, str) and HOST_RE.match(name) else None


def day_start(epoch):
    return int(epoch // DAY) * DAY


def _line(counter, host, frm, now, value=None, unknown=None, quality="exact", cov=None, src=None, excluded=None, needs=None):
    cov = cov or {"first_at": None, "last_at": None, "rows": 0, "covers_window": 0.0}
    rec = {"v": 1, "id": "%s@%s@%d" % (counter, host, frm), "tool": TOOL, "counter": counter, "host": host,
           "window": {"from": frm, "to": frm + DAY}, "value": value, "unknown": unknown, "quality": quality,
           "coverage": cov, "src": src}
    if value is not None:
        rec["excluded"] = excluded or {}
    elif needs:
        rec["needs"] = needs
    rec.update(read_at=int(now), reader=READER, supersedes=None)
    return rec


def _counted(counter, table, rows, filt=None):
    """The `src` of a number: the table, the filter, the first and last row counted and the digest of exactly those rows."""
    ids = [r["id"] for r in rows if "id" in r]
    return {"kind": "table", "file": table, "filter": filt or FILTERS[counter], "first_ref": ("id:%d" % min(ids)) if ids else None,
            "last_ref": ("id:%d" % max(ids)) if ids else None, "digest": digest(rows), "canon": CANON}


def coverage(first_at, last_at, frm, rows):
    """How much of the day [frm, frm+DAY) the table can speak for: from its first row to the end of the day."""
    if first_at is None or first_at >= frm + DAY:
        share = 0.0
    else:
        share = min(1.0, (frm + DAY - max(frm, first_at)) / DAY)
    return {"first_at": int(first_at) if first_at is not None else None, "last_at": int(last_at) if last_at is not None else None,
            "rows": int(rows), "covers_window": round(share, 6) if share < 1.0 else 1.0}


def _number(counter, host, frm, now, rows, cov, quality, sample, value=None, table=None):
    """A counted number, or the unknown it must be: a zero or a count over a day only partly covered is a floor, and a
    floor of nothing is no reading (docs/ledger-spec.md, 'How unknown is written')."""
    value = len(rows) if value is None else value
    if cov["covers_window"] <= 0 or (value == 0 and (cov["covers_window"] < 1.0 or quality == "lower-bound")):
        return _line(counter, host, frm, now, unknown="source-truncated", quality="lower-bound", cov=cov)
    quality = "lower-bound" if cov["covers_window"] < 1.0 and quality == "exact" else quality
    return _line(counter, host, frm, now, value, None, quality, cov, _counted(counter, table or TABLE[counter], rows),
                 {"sample": sample} if sample else {})


def compute(data, frm, host, now, lost_after_s, salt):
    """The lines for the closed day [frm, frm+DAY) from `data`, the rows the host holds:

        pushes   [{id, source_id, received_at, status, gap, mode}] for the day, and `ok_before`, the day's accepted pushes
                 plus those of the `lost_after_s` before it (silence episodes need them)
        events   [{id, source_id, at, owner, item, grp, kind, sample}] for the day
        done     [{id, key, owner, grp, via, at, source_id, sample}] for the day
        sources  {source id: first_seen} the host knows now
        first    the epoch of the host's first push: the history every other table is read against
        last     the epoch of its last push
        total    {pushes, events, done: how many rows the day has, sample or not}

    Pure: no clock, no I/O. A day on which no push at all arrived is not a quiet day: the host may not have been running, and
    it records no heartbeat, so every counter that depends on pushes is unknown for that day."""
    out = []
    pushes = data["pushes"]
    first, last, total = data["first"], data["last"], data["total"]
    if not pushes:
        for c in RECORDED[:-1]:
            out.append(_line(c, host, frm, now, unknown="field-absent", cov=coverage(first, last, frm, 0), needs=NO_HEARTBEAT))
    else:
        real = [p for p in pushes if p["mode"] != "sample"]
        sample = len(pushes) - len(real)
        ok = [p for p in real if p["status"] == "ok"]
        cp = coverage(first, last, frm, total["pushes"])
        out.append(_number("pushes_ok", host, frm, now, ok, cp, "exact", sample))
        out.append(_number("pushes_rejected", host, frm, now, [p for p in real if p["status"] == "rejected"], cp, "exact", sample))
        missed = [p for p in ok if p["gap"]]
        out.append(_number("feeds_missed", host, frm, now, missed, cp, "exact", sample, value=sum(p["gap"] for p in missed)))
        for sid in sorted((s for s, seen in data["sources"].items() if seen < frm + DAY), key=lambda s: source_key(s, salt)):
            name = SOURCE_PREFIX + source_key(sid, salt)
            mine = [p for p in ok if p["source_id"] == sid]
            line = _number("pushes_ok", host, frm, now, mine, cp, "exact", 0)
            line["counter"], line["id"] = name, "%s@%s@%d" % (name, host, frm)
            if line["src"]:
                line["src"]["filter"] = "status=ok mode!=sample, one source (its key is the counter's suffix, ADDINS.md)"
            out.append(line)
        # A source's last accepted push with no accepted push after it for lost_after_s: the board said "lost" from then on.
        later = {}
        for p in sorted(data["ok_before"], key=lambda p: (p["source_id"] or "", p["received_at"])):
            later.setdefault(p["source_id"], []).append(p)
        eps = []
        for sid, rows in later.items():
            if sid not in data["sources"]:
                continue
            for i, p in enumerate(rows):
                nxt = rows[i + 1]["received_at"] if i + 1 < len(rows) else None
                start = p["received_at"] + lost_after_s
                if frm <= start < frm + DAY and (nxt is None or nxt - p["received_at"] > lost_after_s):
                    eps.append(p)
        out.append(_number("silence_episodes", host, frm, now, eps, cp, "rebuilt", 0))
        for name, kinds in KINDS.items():
            ce = coverage(first, last, frm, total["events"])
            rows = [e for e in data["events"] if e["kind"] in kinds and not e["sample"]]
            # The first feed of a source yields no event: a source that began today may have shown more than its rows say.
            quality = "lower-bound" if any(frm <= v < frm + DAY for v in data["sources"].values()) else "exact"
            out.append(_number(name, host, frm, now, rows, ce, quality, sum(1 for e in data["events"] if e["sample"] and e["kind"] in kinds)))
        cd = coverage(first, last, frm, total["done"])
        out.append(_number("landed", host, frm, now, [d for d in data["done"] if not d["sample"]], cd, "exact", sum(1 for d in data["done"] if d["sample"])))
    for c in ("surfaced_cleared", *NOT_MEASURABLE):
        out.append(_line(c, host, frm, now, unknown="field-absent" if c == "surfaced_cleared" else "not-measurable", needs=NEEDS[c]))
    return out


# ---- the host's rows ---------------------------------------------------------------------------------------------------
def _rows(conn, sql, args=()):
    return [dict(r) for r in conn.execute(sql, args)]


def day_data(conn, frm, lost_after_s):
    to = frm + DAY
    data = {"total": {}}
    data["first"], data["last"] = conn.execute("SELECT MIN(received_at), MAX(received_at) FROM pushes").fetchone()
    for table, col in (("pushes", "received_at"), ("events", "at"), ("done", "at")):
        data["total"][table] = conn.execute("SELECT COUNT(*) FROM %s WHERE %s>=? AND %s<?" % (table, col, col), (frm, to)).fetchone()[0]
    data["pushes"] = _rows(conn, "SELECT id, source_id, received_at, status, COALESCE(gap,0) AS gap, COALESCE(mode,'') AS mode FROM pushes "
                                 "WHERE received_at>=? AND received_at<? ORDER BY id", (frm, to))
    data["ok_before"] = _rows(conn, "SELECT id, source_id, received_at FROM pushes WHERE status='ok' AND COALESCE(mode,'')!='sample' "
                                    "AND received_at>=? AND received_at<? ORDER BY id", (frm - lost_after_s, to))
    data["events"] = _rows(conn, "SELECT id, source_id, at, owner, item, grp, kind, COALESCE(sample,0) AS sample FROM events "
                                 "WHERE at>=? AND at<? ORDER BY id", (frm, to))
    data["done"] = _rows(conn, "SELECT id, key, owner, grp, via, at, source_id, COALESCE(sample,0) AS sample FROM done "
                               "WHERE at>=? AND at<? ORDER BY id", (frm, to))
    data["sources"] = {r["id"]: r["first_seen"] or 0 for r in conn.execute("SELECT id, first_seen FROM sources")}
    return data


def _check(path, max_bytes):
    """-> (text, why): the ledger as it is, or why it must not be touched. A missing file is an empty ledger."""
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return "", None
    except OSError:
        return None, "the ledger cannot be inspected"
    if not os.path.isfile(path) or os.path.islink(path):
        return None, "the ledger is not a plain file"
    if st.st_size > max_bytes:
        return None, "the ledger is larger than ledger.max_kb"
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
        text = raw.decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return None, "the ledger cannot be read as UTF-8"
    if text and not text.endswith("\n"):
        return None, "the ledger ends in a torn line"
    parsed = ledger.parse(text, TOOL)
    if any(s["reason"] == "wrong-tool" for s in parsed["skipped"]):
        return None, "the ledger holds lines of another tool"
    return text, None


def _append_atomic(path, old, lines):
    """The old bytes plus the new lines, in a temporary file in the same folder, fsynced and renamed over: a reader sees the
    old file or the new one, never half of either."""
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=os.path.basename(path) + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(old.encode("utf-8"))
            fh.write(("".join(json.dumps(r, separators=(",", ":"), ensure_ascii=False) + "\n" for r in lines)).encode("utf-8"))
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


def write(conn, now, path, host=None, lost_after_s=None, max_kb=8192, dry_run=False, salt=None, max_days=None):
    """Append the lines of every closed UTC day not in the ledger yet, at most `max_days` of them. -> {state, days, lines, why,
    more}. A day is closed GRACE seconds after it ends, and a day whose window the ledger already holds, under any host label,
    is not written again.

    state is `written`, `current` (nothing new to write), `refused` (the ledger is not safe to append to; it is untouched) or
    `no-history` (the host has no push yet). `more` is true when days were left for a later run."""
    salt = salt or install_salt()
    host = host or host_label(salt=salt)
    lost = lost_after_s if lost_after_s is not None else config.get()["thresholds"]["lost_after_s"]
    path = str(path)
    if not dry_run:
        os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    with (contextlib.nullcontext() if dry_run else osx.file_lock(os.path.join(os.path.dirname(path), "weatherdeck.lock"))):
        old, why = _check(path, max_kb * 1024)
        if why:
            return {"state": "refused", "days": 0, "lines": 0, "why": why, "more": False}
        active = ledger.parse(old, TOOL)["active"]
        have = {r["id"] for r in active}
        held = {r["window"]["from"] for r in active if isinstance(r.get("window"), dict)}
        first = conn.execute("SELECT MIN(received_at) FROM pushes").fetchone()[0]
        if first is None:
            return {"state": "no-history", "days": 0, "lines": 0, "why": None, "more": False}
        end = day_start(now - GRACE)
        lo = max(day_start(first), end - MAX_DAYS * DAY)
        new, days, more = [], 0, False
        for frm in range(int(lo), int(end), DAY):
            if frm in held:
                continue
            if max_days is not None and days >= max_days:
                more = True
                break
            lines = [r for r in compute(day_data(conn, frm, lost), frm, host, now, lost, salt) if r["id"] not in have]
            if lines:
                new += lines
                days += 1
        if not new or dry_run:
            return {"state": "current" if not new else "dry-run", "days": days, "lines": len(new), "why": None, "more": more,
                    "preview": new if dry_run else None}
        _append_atomic(path, old, new)
        return {"state": "written", "days": days, "lines": len(new), "why": None, "more": more}


def run(conn, now, cfg=None, dry_run=False, max_days=None):
    """write() with the configured folder and size, the install's salt, and the host label of the first write, which is
    recorded in the data directory then and kept after (ADDINS.md, 'Writing the ledger')."""
    cfg = cfg if cfg is not None else config.get().get("ledger") or {}
    data = config.data_dir()
    folder = os.path.expanduser(cfg["dir"]) if cfg.get("dir") else str(data / "ledger")
    salt = install_salt(data)
    host = kept_host(data) or host_label(cfg, salt)
    res = write(conn, now, os.path.join(folder, TOOL + ".jsonl"), host, max_kb=int(cfg.get("max_kb") or 8192), dry_run=dry_run,
                salt=salt, max_days=max_days)
    if res["state"] == "written" and kept_host(data) is None:
        store.write_json_atomic(data / STATE_FILE, {"host": host})
    return res


_seen = {"day": None}


def tick(conn, now):
    """Called by the host after an accepted push, once the ingest lock is released. Does nothing but one comparison unless the
    UTC day (less GRACE) changed since it last ran in this process (or this is its first call): then it writes up to TICK_DAYS
    closed days not written yet, and the next push writes more if any are left. Never raises."""
    try:
        cfg = config.get().get("ledger") or {}
        if not cfg.get("write"):
            return None
        day = day_start(now - GRACE)
        if _seen["day"] == day:
            return None
        _seen["day"] = day
        res = run(conn, now, cfg, max_days=TICK_DAYS)
        if res["more"]:
            _seen["day"] = None
        if res["state"] == "refused":
            log.warning("ledger not written: %s", res["why"])
        elif res["state"] == "written":
            log.info("ledger: %d lines for %d days", res["lines"], res["days"])
        return res
    except Exception:
        log.exception("ledger write failed")
        return None
