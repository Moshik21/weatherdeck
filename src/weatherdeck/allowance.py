"""Allowance chips: one per account a source reports in `meters.accounts[]`, in a fixed order.

Pure functions. Each chip names the provider, the account, the window that is lowest, the percent left in it and when
it resets. The sentence about running out comes only from the source's own projection (`runway`): the host never
projects anything from percentages, and one chip's sentence never borrows another account's. Which providers are
shown is the viewer's choice (config `display.allowance.providers`); an empty list shows every provider a source sends.
"""
from datetime import datetime, timezone

from . import gaps

LOW_PCT = 25     # below this much left the chip reads low
OUT_PCT = 5      # at or below this much left (or a projection of exhausted) it reads out
SHORT_WINDOWS = {"five_hour": "5h", "seven_day": "wk", "day": "day", "week": "wk", "month": "mo"}


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v else None


def _epoch(iso):
    if not isinstance(iso, str):
        return None
    try:
        return datetime.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        return None


def names(acc):
    """(provider, account) for an account: its 1.1 fields, else its 1.0 label "Provider, account"."""
    label = str(acc.get("label") or acc.get("id") or "")
    head, _, tail = label.partition(",")
    provider = (acc.get("provider") or "").strip() or head.strip() or str(acc.get("id"))
    account = (acc.get("account") or "").strip() or tail.strip() or None
    if provider and provider.islower():
        provider = provider[:1].upper() + provider[1:]
    return provider, account


def window_short(w):
    if w.get("short"):
        return str(w["short"])[:6]
    wid = str(w.get("id") or "")
    if wid in SHORT_WINDOWS:
        return SHORT_WINDOWS[wid]
    lab = str(w.get("label") or wid)
    return lab[:4]


def when(epoch, tz, now):
    """'14:00' today, 'Wed 14:00' within the week, '12 Oct' later (in the display time zone)."""
    if epoch is None:
        return None
    t = datetime.fromtimestamp(epoch, tz)
    n = datetime.fromtimestamp(now, tz)
    if t.date() == n.date():
        return t.strftime("%H:%M")
    if 0 < (t.date() - n.date()).days < 7:
        return t.strftime("%a %H:%M")
    return "%d %s" % (t.day, t.strftime("%b"))


def chip(acc, now, tz, labels=None, stale=False, label_reset_zone=False):
    """One chip: {id, source, provider, account, window, left, resets_at, resets, state, projection, sentence, forms}.
    state is ok | low | out | unavailable. forms are the chip's words from fullest to shortest, for the page to fit."""
    L = labels or {}
    provider, account = names(acc)
    wins = [w for w in acc.get("windows") or [] if isinstance(w, dict) and _num(w.get("percent_remaining")) is not None]
    low = min(wins, key=lambda w: (w["percent_remaining"], str(w.get("id")))) if wins else None
    rw = acc.get("runway") if isinstance(acc.get("runway"), dict) else {}
    status = rw.get("status") if rw.get("status") in ("through_reset", "exhausts_before_reset", "exhausted") else "unknown"
    empty_at = _epoch(rw.get("projected_empty_at"))
    who = provider + (" (" + account + ")" if account else "")
    # The countdown to exhaustion is the source's own projection read against the host clock, never a rate worked out
    # here: without a projected_empty_at there is no countdown.
    countdown = max(0, int(empty_at - now)) if status == "exhausts_before_reset" and empty_at is not None else None
    base = {"id": acc.get("id"), "source": acc.get("source"), "provider": provider, "account": account,
            "projection": {"status": status, "empty_at": rw.get("projected_empty_at"), "confidence": rw.get("confidence"),
                           "source": rw.get("source")}, "countdown_s": countdown, "back_in_s": None}
    if low is None or stale:
        word = L.get("chip_unavailable", "unavailable")
        return dict(base, window=None, left=None, resets_at=None, resets=None, state="unavailable", sentence=None,
                    forms=[" ".join(x for x in (provider, account, word) if x), " ".join(x for x in (provider, word) if x),
                           provider[:3] + " ?"])
    left = int(round(max(0, min(100, low["percent_remaining"]))))
    reset_ep = _epoch(low.get("resets_at"))
    resets = when(reset_ep, tz, now)
    if resets and label_reset_zone:
        offset = datetime.fromtimestamp(reset_ep).astimezone().strftime("%z")
        resets += " (UTC%s:%s)" % (offset[:3], offset[3:])
    back_in = max(0, int(reset_ep - now)) if status == "exhausted" and reset_ep is not None else None
    state = "out" if left <= OUT_PCT or status == "exhausted" else "low" if left < LOW_PCT or status == "exhausts_before_reset" else "ok"
    short = window_short(low)
    sentence = None
    if status == "exhausted":
        sentence = L.get("chip_out", "{who} is out until the {window} reset {t}").format(who=who, window=low.get("label") or short, t=resets or "?")
    elif status == "exhausts_before_reset" and empty_at is not None:
        sentence = L.get("chip_runs_out", "{who} may run out {in} ({empty}), before the {window} reset {t}").replace("{in}", gaps.until(countdown) or "?").format(
            who=who, empty=when(empty_at, tz, now), window=low.get("label") or short, t=resets or "?")
    pct = "%d%%" % left
    tail = (" " + resets) if resets else ""
    forms = [" ".join(x for x in (provider, account, short, pct) if x) + tail,
             " ".join(x for x in (provider, account, short, pct) if x),
             " ".join(x for x in (provider, short, pct) if x),
             provider[:3] + " " + pct]
    if countdown is not None:   # the countdown leads the chip's fuller forms: it is what the chip is for
        out_in = L.get("chip_out_in", "out {in}").replace("{in}", gaps.until(countdown) or "?")
        forms = [forms[1] + " " + out_in, forms[2] + " " + out_in] + forms
    return dict(base, back_in_s=back_in, window={"id": low.get("id"), "label": low.get("label"), "short": short}, left=left,
                resets_at=low.get("resets_at"), resets=resets, state=state, sentence=sentence, forms=forms)


def chips(accounts, now, tz, providers=None, labels=None, stale_sources=(), label_reset_zone=False):
    """Every account's chip, only for the listed providers when a list is given, in a fixed order: provider, then
    account, then id. The order never depends on percentages, so chips do not swap places as they move."""
    want = {str(p).lower() for p in providers or [] if p}
    out = []
    for acc in accounts or []:
        if not isinstance(acc, dict):
            continue
        provider, _ = names(acc)
        raw = str(acc.get("provider") or provider).lower()
        if want and raw not in want and provider.lower() not in want:
            continue
        out.append(chip(acc, now, tz, labels, stale=acc.get("source") in stale_sources,
                        label_reset_zone=label_reset_zone))
    out.sort(key=lambda c: (c["provider"].lower(), (c["account"] or "").lower(), str(c["id"])))
    return out
