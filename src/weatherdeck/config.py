"""Configuration and paths.

Defaults ship in defaults.json. One optional config file (JSON) is deep-merged over them:
--config FILE, else $WEATHERDECK_CONFIG, else <data dir>/config.json. The file is re-read when it
changes, and a file that fails to parse keeps the last good config.
"""
import json
import logging
import os
from pathlib import Path

from . import osx

PKG = Path(__file__).resolve().parent
ROOT = PKG.parents[1]
WEB = Path(os.environ.get("WEATHERDECK_WEB") or ROOT / "web")
DEFAULTS_FILE = PKG / "defaults.json"

log = logging.getLogger("weatherdeck.config")
_state = {"data_dir": None, "config_path": None, "stamp": None, "cfg": None, "user": {}}


def platform_data_dir():
    return osx.default_data_dir()


def _read_json(path):
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    if not isinstance(doc, dict):
        raise ValueError(f"{path}: the top level must be an object")
    return doc


def _merge(base, over):
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _merge(base[k], v)
        else:
            base[k] = v
    return base


def init(data_dir=None, config_path=None):
    """Resolve the data dir and config path. Call once per process, before get()."""
    explicit = data_dir or os.environ.get("WEATHERDECK_DATA")
    candidate = Path(explicit).expanduser() if explicit else platform_data_dir()
    cpath = config_path or os.environ.get("WEATHERDECK_CONFIG") or str(candidate / "config.json")
    cpath = Path(cpath).expanduser()
    if not explicit and cpath.exists():
        try:
            cfg_dir = _read_json(cpath).get("data_dir")
            if cfg_dir:
                candidate = Path(cfg_dir).expanduser()
        except Exception:
            pass
    _state.update(data_dir=candidate.resolve(), config_path=cpath, stamp=None, cfg=None)
    return _state["data_dir"]


def data_path():
    """The data dir as resolved, without creating it (for read-only commands such as `weatherdeck doctor --host`)."""
    if _state["data_dir"] is None:
        init()
    return _state["data_dir"]


def data_dir():
    d = data_path()
    old = os.umask(0o077)
    try:
        d.mkdir(parents=True, exist_ok=True)
    finally:
        os.umask(old)
    return d


def config_path():
    if _state["config_path"] is None:
        init()
    return _state["config_path"]


def get():
    path = config_path()
    try:
        st = path.stat()
        stamp = (st.st_mtime_ns, st.st_size)
    except FileNotFoundError:
        stamp = None
    if _state["cfg"] is not None and stamp == _state["stamp"]:
        return _state["cfg"]
    try:
        cfg = _read_json(DEFAULTS_FILE)
        user = _read_json(path) if stamp is not None else {}
        _merge(cfg, json.loads(json.dumps(user)))
        _state["cfg"], _state["user"] = cfg, user
    except Exception as exc:
        if _state["cfg"] is None:
            raise
        log.error("config reload failed, keeping the previous config: %s", exc)
    _state["stamp"] = stamp
    return _state["cfg"]


def user_labels():
    """Label keys the config file sets itself; they win over a theme's words."""
    get()
    labels = _state["user"].get("labels")
    return sorted(labels) if isinstance(labels, dict) else []


def setup_logging(name, stderr=False):
    """Size-capped file log in the data dir (1 MB, one backup)."""
    from logging.handlers import RotatingFileHandler

    handler = RotatingFileHandler(data_dir() / f"{name}.log", maxBytes=1_000_000, backupCount=1)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)
    if stderr:
        root.addHandler(logging.StreamHandler())
