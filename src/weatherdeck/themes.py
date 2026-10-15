"""Theme folders under web/themes/: which one the page uses, and whether it is sound.

A theme is a folder of tokens.json plus the files it names (fonts, glyphs, sprites, a scene module).
The browser merges the chain itself (docs/theme-spec.md section 2); the host only picks a valid
theme and serves its files. A theme that is missing or fails its schema falls back to `default`,
logged once. `check()` runs the acceptance checks that need no browser: schema, font integrity
and licence files, and the contrast pairs recomputed from the resolved tokens.
"""
import base64
import hashlib
import json
import logging
import re

from . import config

log = logging.getLogger("weatherdeck.themes")
DEFAULT = "default"
ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,31}$")
SERVED = {".json", ".woff2", ".js", ".txt"}
_logged = set()


def root():
    return config.WEB / "themes"


def tokens(name):
    with open(root() / name / "tokens.json", encoding="utf-8") as fh:
        return json.load(fh)


def names():
    return sorted(p.name for p in root().iterdir() if (p / "tokens.json").is_file()) if root().is_dir() else []


# ---- a JSON Schema subset: the keywords theme.schema.json uses ----------------------------------
_TYPES = {"object": dict, "array": list, "string": str, "boolean": bool, "null": type(None)}


def _is(kind, v):
    if kind == "integer":
        return isinstance(v, int) and not isinstance(v, bool)
    if kind == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    return isinstance(v, _TYPES[kind]) and not (kind != "boolean" and isinstance(v, bool))


def validate(doc, schema, node=None, path="$"):
    """Problems found validating doc against schema, as 'path: why' strings."""
    node = schema if node is None else node
    out = []
    if "$ref" in node:
        ref = node["$ref"]
        target = schema
        for part in ref.lstrip("#/").split("/"):
            target = target[part]
        return validate(doc, schema, target, path)
    if "type" in node:
        kinds = node["type"] if isinstance(node["type"], list) else [node["type"]]
        if not any(_is(k, doc) for k in kinds):
            return [f"{path}: expected {'/'.join(kinds)}"]
    if "const" in node and doc != node["const"]:
        out.append(f"{path}: must be {json.dumps(node['const'])}")
    if "enum" in node and doc not in node["enum"]:
        out.append(f"{path}: must be one of {node['enum']}")
    if "pattern" in node and isinstance(doc, str) and not re.search(node["pattern"], doc):
        out.append(f"{path}: does not match {node['pattern']}")
    if "minimum" in node and _is("number", doc) and doc < node["minimum"]:
        out.append(f"{path}: below {node['minimum']}")
    if isinstance(doc, list):
        if "minItems" in node and len(doc) < node["minItems"]:
            out.append(f"{path}: fewer than {node['minItems']} items")
        if "items" in node:
            for i, v in enumerate(doc):
                out += validate(v, schema, node["items"], f"{path}[{i}]")
    if isinstance(doc, dict):
        for k in node.get("required", []):
            if k not in doc:
                out.append(f"{path}: missing '{k}'")
        props = node.get("properties", {})
        for k, v in doc.items():
            if k in props:
                out += validate(v, schema, props[k], f"{path}.{k}")
            elif isinstance(node.get("additionalProperties"), dict):
                out += validate(v, schema, node["additionalProperties"], f"{path}.{k}")
    return out


def chain(name):
    """[tokens of name, its parent, ..., default]; raises ValueError on a loop, a bad id or a missing parent."""
    out, seen = [], set()
    while name:
        if not ID_RE.match(name) or name in seen:
            raise ValueError(f"bad or looping theme id {name!r}")
        seen.add(name)
        doc = tokens(name)
        if doc.get("id") != name:
            raise ValueError(f"{name}/tokens.json says id {doc.get('id')!r}")
        out.append(doc)
        name = doc.get("extends") or (None if name == DEFAULT else DEFAULT)
    if out[-1].get("id") != DEFAULT:
        raise ValueError("the chain does not end at default")
    return out


def problems(name):
    """Why this theme cannot be used: schema, chain and font files. Empty when it is sound."""
    try:
        with open(root() / "theme.schema.json", encoding="utf-8") as fh:
            schema = json.load(fh)
        docs = chain(name)
    except (OSError, ValueError) as exc:
        return [str(exc)]
    out = []
    for doc in docs:
        tid = doc.get("id")
        out += [f"{tid}: {p}" for p in validate(doc, schema)]
        for f in doc.get("fonts") or []:
            base = root() / tid
            try:
                data = (base / f["file"]).read_bytes()
                got = "sha256-" + base64.b64encode(hashlib.sha256(data).digest()).decode()
                if got != f.get("integrity"):
                    out.append(f"{tid}: {f['file']} integrity is {got}, tokens say {f.get('integrity')}")
            except (OSError, KeyError) as exc:
                out.append(f"{tid}: font {f.get('file')}: {exc}")
            if not (base / f.get("licence_file", "")).is_file():
                out.append(f"{tid}: licence file {f.get('licence_file')} is missing")
    return out


def resolve(name):
    """The theme the page should load: name when it is sound, else default (logged once)."""
    name = name or DEFAULT
    if name == DEFAULT:
        return DEFAULT
    bad = problems(name)
    if bad:
        if name not in _logged:
            _logged.add(name)
            log.error("theme %r cannot be used, falling back to default: %s", name, "; ".join(bad[:5]))
        return DEFAULT
    return name


# ---- checks that need no browser (docs/theme-spec.md section 14, checks 1 and 2) -----------------
def _merge(base, over):
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _merge(base[k], v)
        else:
            base[k] = v
    return base


def merged(name):
    docs = chain(name)
    out = {}
    for doc in reversed(docs):
        _merge(out, json.loads(json.dumps(doc)))
    core = docs[-1]["color"]  # status and ink never theme
    out["color"]["status"], out["color"]["ink"] = core["status"], core["ink"]
    return out


def _lum(hexs):
    def ch(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (int(hexs[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast(a, b):
    la, lb = sorted((_lum(a), _lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def check(name):
    """(lines, ok): every problem plus each contrast pair recomputed from the resolved tokens."""
    lines, ok = [], True
    for p in problems(name):
        lines.append("FAIL " + p)
        ok = False
    try:
        t = merged(name)
    except (OSError, ValueError) as exc:
        return lines + [f"FAIL {exc}"], False
    col = t["color"]
    for pair in (t.get("checks") or {}).get("contrast") or []:
        mode = pair["mode"]
        table = dict(col["status"].get(mode, {}), **col["ink"].get(mode, {}), **col["surface"].get(mode, {}))
        bg = table.get(pair["bg"])
        fgs = [table.get(f) for f in pair["fg"].split("|")]
        if not bg or not all(fgs):
            lines.append(f"FAIL {mode} {pair['fg']} on {pair['bg']}: a colour is missing")
            ok = False
            continue
        got = max(contrast(f, bg) for f in fgs)
        good = got + 0.005 >= pair["floor"]
        ok &= good
        lines.append(f"{'ok  ' if good else 'FAIL'} {mode:5} {pair['fg']:>16} on {pair['bg']:<9} {got:5.2f} (floor {pair['floor']}, tokens say {pair['ratio']})")
    for pair in (t.get("checks") or {}).get("cvd") or []:
        good = pair["worst"] >= 8
        ok &= good
        lines.append(f"{'ok  ' if good else 'FAIL'} {pair['mode']:5} cvd {pair['a']}/{pair['b']} worst {pair['worst']}")
    return lines, ok
