"""Two feeds to raise a machine alert, two to clear it (docs/honesty.md, rule 8; docs/feed-spec.md, "Machine alerts").

Pure functions: no I/O, no clock. The host keeps one small state per (source, alert id) between pushes (store.py,
machine_alerts) and folds each accepted feed into it (`step`); the view reads it (`split`).

Only a machine alert is debounced: an `attention[]` card of kind `machine` or `disk` that is not `critical`. A critical
and a supervision or service card pass straight through, in both directions: they raise on the first feed that says them
and clear on the first that does not. The price is stated, never hidden: a machine alert can take up to one keepalive
longer to appear and one longer to go than the source's own state. While an alert is not yet confirmed it is listed as
pending, never dropped, so a machine with a possible alert never reads as healthy.

State of one alert: {present, absent, raised, card}: present and absent count consecutive feeds (capped at NEED), raised
is whether the board is showing it, and card is the last card the source sent (kept so a clearing alert can still be said).
"""

NEED = 2                                    # consecutive feeds to raise and, again, to clear
MACHINE_KINDS = ("machine", "disk")         # what a machine alert is
NEVER = ("service",)                        # kinds that always pass straight through (supervision down, a daemon down)
NEVER_ID_PREFIX = ("service:", "host:")     # the same, by id, whatever kind or severity a source gave it


def is_machine_alert(card):
    """Whether a card is debounced: a machine or disk card that is not critical, not a service or supervision card, and
    not the host's own `host:<machine>:lost` card (which the host builds, never a source)."""
    if not isinstance(card, dict) or card.get("severity") == "critical":
        return False
    cid = str(card.get("id") or "")
    if card.get("kind") in NEVER or cid.startswith(NEVER_ID_PREFIX):
        return False
    return card.get("kind") in MACHINE_KINDS


def step(state, card):
    """Fold one accepted feed into an alert's state. card is the alert's card in that feed, or None when it is absent.
    -> the new state, or None once it has cleared (nothing left to keep)."""
    st = dict(state or {"present": 0, "absent": 0, "raised": False, "card": None})
    if card is not None:
        st["present"], st["absent"], st["card"] = min(NEED, st["present"] + 1), 0, card
        if st["present"] >= NEED:
            st["raised"] = True
        return st
    st["absent"], st["present"] = min(NEED, st["absent"] + 1), 0
    if not st["raised"] or st["absent"] >= NEED:
        return None                         # never raised, or two feeds without it: gone
    return st


def split(state, card):
    """How the board treats an alert now. -> (phase, card): phase is 'raised' (confirmed, counted), 'raising' (said once,
    not confirmed yet: pending), 'clearing' (confirmed, left out of the newest feed once: still raised, held) or None
    (absent and not held). card is the card to show (the newest the source sent, else the held one)."""
    st = state or {}
    if card is not None:
        return ("raised" if st.get("raised") else "raising", card)
    if st.get("raised") and st.get("card"):
        return "clearing", st["card"]
    return None, None
