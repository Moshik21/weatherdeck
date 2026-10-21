"""Add-in cards: one small JSON status card per tool, read from a drop directory (docs/ADDINS.md).

A card is data. Nothing here imports, runs or locates a tool, opens a socket, or reads anything but
`*.json` files of regular, small size in one directory. The shape is the JSON Schema in
card.schema.json, interpreted by `check` below (a small stdlib subset), so the file and the
validator cannot drift; the few rules a schema cannot say are in `validate`.
"""
import json
import logging
import os
import re
import time
from pathlib import Path

from . import config, ledgercards, schema, store

log = logging.getLogger("weatherdeck.cards")

SCHEMA_FILE = config.PKG / "card.schema.json"
MAJOR = 1
MAX_BYTES = 16 * 1024
FUTURE_SKEW_S = 300
LEDGER_PREFIX = "ledger-"
STATUS_RANK = {"bad": 0, "warn": 1, "unknown": 2, "ok": 3}
_logged = set()


class Invalid(Exception):
    pass


def _spec():
    with open(SCHEMA_FILE, encoding="utf-8") as fh:
        return json.load(fh)


# ---- the schema subset: type, const, enum, pattern, min/maxLength, minimum/maximum, maxItems, items, required, properties ----
_TYPES = {"object": dict, "array": list, "string": str, "boolean": bool}


def _is(val, name):
    if name in ("number", "integer"):
        if isinstance(val, bool) or not isinstance(val, (int, float)) or val != val:
            return False
        return name == "number" or isinstance(val, int) or float(val).is_integer()
    return isinstance(val, _TYPES[name])


def check(val, spec, path="card"):
    if "const" in spec and val != spec["const"]:
        raise Invalid(f"{path}: must be {spec['const']!r}")
    if "enum" in spec and val not in spec["enum"]:
        raise Invalid(f"{path}: must be one of {', '.join(map(str, spec['enum']))}")
    types = spec.get("type")
    if types is not None:
        names = types if isinstance(types, list) else [types]
        if not any(_is(val, n) for n in names):
            raise Invalid(f"{path}: expected {' or '.join(names)}")
    if isinstance(val, str):
        if "minLength" in spec and len(val) < spec["minLength"]:
            raise Invalid(f"{path}: must not be empty")
        if "maxLength" in spec and len(val) > spec["maxLength"]:
            raise Invalid(f"{path}: longer than {spec['maxLength']} characters")
        if "pattern" in spec and not re.search(spec["pattern"], val):
            raise Invalid(f"{path}: not in the expected form")
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        if "minimum" in spec and val < spec["minimum"]:
            raise Invalid(f"{path}: below {spec['minimum']}")
        if "maximum" in spec and val > spec["maximum"]:
            raise Invalid(f"{path}: above {spec['maximum']}")
    if isinstance(val, list):
        if "maxItems" in spec and len(val) > spec["maxItems"]:
            raise Invalid(f"{path}: {len(val)} entries, the limit is {spec['maxItems']}")
        for i, item in enumerate(val):
            check(item, spec.get("items") or {}, f"{path}[{i}]")
    if isinstance(val, dict):
        for key in spec.get("required") or []:
            if key not in val:
                raise Invalid(f"{path}.{key}: required")
        for key, sub in (spec.get("properties") or {}).items():
            if key in val:
                check(val[key], sub, f"{path}.{key}")
    return val


def validate(doc, now=None):
    """-> the card, reduced to the known fields. Raises Invalid with a one-line reason."""
    if not isinstance(doc, dict):
        raise Invalid("the card must be a JSON object")
    check(doc, _spec())
    if int(doc["schema_version"].split(".")[0]) != MAJOR:
        raise Invalid(f"card is version {doc['schema_version']}, this dashboard reads {MAJOR}.x: update the dashboard")
    try:
        at = schema.parse_time(doc["updated_at"])
    except ValueError:
        raise Invalid("card.updated_at: not a real time") from None
    if at - (now or time.time()) > FUTURE_SKEW_S:
        raise Invalid("card.updated_at: more than 5 minutes in the future (is the tool's clock right?)")
    known = _spec()["properties"]
    return {k: doc[k] for k in known if k in doc}


def parse_file(path):
    """Read one card file: -> (card, None) or (None, reason). Reads data only."""
    try:
        st = os.lstat(path)
    except OSError as exc:
        return None, f"cannot read: {exc.strerror or exc}"
    if not os.path.isfile(path) or os.path.islink(path):
        return None, "not a regular file"
    if st.st_size > MAX_BYTES:
        return None, f"larger than {MAX_BYTES // 1024} KiB"
    try:
        with open(path, "rb") as fh:
            raw = fh.read(MAX_BYTES + 1)
        doc = json.loads(raw.decode("utf-8"))
    except (OSError, ValueError) as exc:
        return None, f"not valid JSON: {exc}"
    try:
        return validate(doc), None
    except Invalid as exc:
        return None, str(exc)


def drop_dir():
    d = config.get()["cards"].get("dir")
    return os.path.expanduser(d) if d else str(config.data_dir() / "cards")


def stale_after(card):
    return card.get("stale_after_s") or config.get()["cards"]["stale_after_s"]


def load_dir(directory, now=None, log_rejects=True, reserved=None):
    """-> (cards, rejected). cards: validated, newest per tool, capped. rejected: [(file name, reason)].

    A missing directory is no cards. A card whose tool id starts with `reserved` is rejected: the board builds that card
    itself. Each rejected file version is logged once."""
    cards, rejected, now = {}, [], now or time.time()
    try:
        names = sorted(n for n in os.listdir(directory) if n.endswith(".json") and not n.startswith("."))
    except OSError:
        return [], []
    for name in names:
        path = os.path.join(directory, name)
        card, why = parse_file(path)
        if why:
            rejected.append((name, why))
            continue
        if reserved and card["tool"].startswith(reserved):
            rejected.append((name, f"tool id {card['tool']} is the board's own ledger card while ledger.enabled is on"))
            continue
        cur = cards.get(card["tool"])
        if cur is None or schema.parse_time(card["updated_at"]) > schema.parse_time(cur[1]["updated_at"]):
            if cur is not None:
                rejected.append((cur[0], f"superseded by {name} (same tool {card['tool']}, newer)"))
            cards[card["tool"]] = (name, card)
        else:
            rejected.append((name, f"superseded by {cur[0]} (same tool {card['tool']}, newer)"))
    ordered = sorted(cards.values(), key=lambda nc: (STATUS_RANK[nc[1]["status"]], nc[1]["tool"]))
    cap = config.get()["cards"]["max"]
    for name, card in ordered[cap:]:
        rejected.append((name, f"over the limit of {cap} cards"))
    for name, why in rejected if log_rejects else ():
        _log_once(directory, name, why)
    return [c for _, c in ordered[:cap]], rejected


def _log_once(directory, name, why):
    try:
        st = os.stat(os.path.join(directory, name))
        key = (directory, name, st.st_mtime_ns, st.st_size, why)
    except OSError:
        return
    if key not in _logged:
        if len(_logged) > 500:
            _logged.clear()
        _logged.add(key)
        log.warning("card file %s rejected: %s", name, why)


def view(now=None):
    """The cards for /api/view: [{... card fields, stale_after_s: effective}], and the rejected count.

    The drop directory's cards, plus a ledger card per tool when `ledger.enabled` (ledgercards.py); one cap and one order."""
    now = now or time.time()
    shown, rejected = load_dir(drop_dir(), now, reserved=LEDGER_PREFIX if ledgercards.settings().get("enabled") else None)
    count = len(rejected)
    for doc in ledgercards.build(now):
        try:
            shown.append(validate(doc, now))
        except Invalid as exc:
            count += 1
            log.warning("ledger card %s rejected: %s", doc.get("tool"), exc)
    shown.sort(key=lambda c: (STATUS_RANK[c["status"]], c["tool"]))
    cap = config.get()["cards"]["max"]
    count += max(0, len(shown) - cap)
    return [dict({k: v for k, v in c.items() if k not in ("schema", "schema_version")}, stale_after_s=stale_after(c)) for c in shown[:cap]], count


def redact(cards, level):
    """household: title, status, mode and age only (the rest is free text a tool wrote); guest: the same without the title; public: none."""
    if level == "public":
        return []
    if level in ("household", "guest"):
        keep = ("tool", "title", "status", "mode", "updated_at", "stale_after_s") if level == "household" else ("tool", "status", "mode", "updated_at", "stale_after_s")
        return [{k: c[k] for k in keep if k in c} for c in cards]
    return cards


def put(directory, card):
    """Write a validated card as <tool>.json, atomically."""
    os.makedirs(directory, mode=0o700, exist_ok=True)
    store.write_json_atomic(Path(directory) / (card["tool"] + ".json"), card)
