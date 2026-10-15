"""Which software each source reports, and where a version gap changes what a machine can say (docs/feed-spec.md,
"Versions").

Pure: no clock, no files. A feed's `producer` carries `name`, `version` (the adapter's), `pusher` {name, version} and
`host`; the adapter that knows its own history also lists `meaning[]`, `{since, effect}`: from which of its versions on a
machine can do something an older one cannot, said in words. The host compares only sources that report the same
producer name, and flags a source only when an older version than a change's `since` runs next to a source that has it.
A version that was not reported is unknown, never guessed, and never takes part in a comparison.
"""
import re

VERSION_RE = re.compile(r"^v?(\d{1,6})(\.\d{1,6}){0,3}$")
MAX_NOTES = 12
MAX_EFFECT = 240


def parse(version):
    """'1.10' -> (1, 10); None when it is not a plain dotted number (then it is shown as reported, never compared)."""
    if not isinstance(version, str) or not VERSION_RE.match(version.strip()):
        return None
    return tuple(int(p) for p in version.strip().lstrip("v").split("."))


def _cmp(a, b):
    """-1, 0, 1 on two parsed versions, a missing trailing part counting as 0 (1.2 == 1.2.0)."""
    n = max(len(a), len(b))
    a, b = a + (0,) * (n - len(a)), b + (0,) * (n - len(b))
    return (a > b) - (a < b)


def _text(value, limit):
    return " ".join(value.split())[:limit] if isinstance(value, str) and value.strip() else None


def producer_of(feed):
    """What one feed says about its own software: {name, version, pusher: {name, version} | None, host, meaning[]}.
    Every field is None (or empty) when the feed did not carry it."""
    prod = feed.get("producer") if isinstance(feed, dict) and isinstance(feed.get("producer"), dict) else {}
    pusher = prod.get("pusher") if isinstance(prod.get("pusher"), dict) else None
    meaning = []
    for m in prod.get("meaning") or []:
        since, effect = _text(m.get("since"), 24) if isinstance(m, dict) else None, _text(m.get("effect"), MAX_EFFECT) if isinstance(m, dict) else None
        if since and effect and parse(since):
            meaning.append({"since": since, "effect": effect})
    return {
        "name": _text(prod.get("name"), 60), "version": _text(prod.get("version"), 24),
        "pusher": ({"name": _text(pusher.get("name"), 60), "version": _text(pusher.get("version"), 24)}
                   if pusher and (pusher.get("name") or pusher.get("version")) else None),
        "host": _text(prod.get("host"), 60), "meaning": meaning[:MAX_NOTES],
    }


def assess(entries):
    """entries: [{source, name, version, meaning[]}] (a source that never reported has name and version None).
    -> {source id: [{since, effect, newer_version, newer_source}]}: for each source, the changes it is too old for while a
    source with the same producer name already runs a version that has them. Sources with an unreported name or a
    version that is not a plain number are never flagged and never the newer one."""
    out = {e["source"]: [] for e in entries}
    groups = {}
    for e in entries:
        v = parse(e.get("version"))
        if e.get("name") and v:
            groups.setdefault(e["name"], []).append((e, v))
    for members in groups.values():
        newest = members[0]
        for cur in members[1:]:
            if _cmp(cur[1], newest[1]) > 0 or (_cmp(cur[1], newest[1]) == 0 and cur[0]["source"] < newest[0]["source"]):
                newest = cur
        changes = {}
        for e, _ in members:
            for m in e.get("meaning") or []:
                changes.setdefault((m["since"], m["effect"]), parse(m["since"]))
        for e, v in members:
            notes = []
            for (since, effect), sv in sorted(changes.items(), key=lambda kv: kv[1]):
                if _cmp(v, sv) < 0 and _cmp(newest[1], sv) >= 0:
                    notes.append({"since": since, "effect": effect, "newer_version": newest[0]["version"], "newer_source": newest[0]["source"]})
            out[e["source"]] = notes[:MAX_NOTES]
    return out
