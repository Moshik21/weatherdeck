"""The keys a redacted view may carry: everything else is dropped, so a field no one has listed here is private.

A shape is True (keep the value as it is), a dict of the keys an object may carry (each with its own shape), a one-item
list (a list of objects of that shape), or a `Word` (a field whose contract is a fixed vocabulary or a short name). A key that
is not listed is dropped; a value that is not the kind of thing its shape says (an object where a list was expected) becomes
None; a `Word` field whose value is not a legal word or name becomes the Word's fallback (the spec's unknown value where it has
one, else None), so a source's sentence cannot ride in a field that is only meant to hold a word. `view.redact` rewrites what a
level may not show, then calls `restrict`. A field added to the feed, or to the view, stays out of the household, guest and
public views until it is listed here on purpose.
"""
import re

_TOKEN = re.compile(r"\w[\w.:-]{0,39}")                       # one word: kebab or snake case, a version-like id
_NAME = re.compile(r"[\w.+/%(),'-]+( [\w.+/%(),'-]+){0,3}")     # a short name: at most four words and 32 characters


class Word:
    """A field that holds a word or a short name: `fits(value)` says whether the value is one."""

    def __init__(self, fits, fallback=None):
        self.fits, self.fallback = fits, fallback


def _token(fallback=None):
    return Word(lambda v: isinstance(v, str) and _TOKEN.fullmatch(v) is not None, fallback)


def _name(fallback=None):
    return Word(lambda v: isinstance(v, str) and len(v) <= 32 and _NAME.fullmatch(v) is not None, fallback)


def _one_of(words, fallback=None):
    words = frozenset(words.split())
    return Word(lambda v: isinstance(v, str) and v in words, fallback)


def _o(keys, **nested):
    return dict({k: True for k in keys.split()}, **nested)


_TOKEN_WORD, _NAME_WORD = _token(), _name()
# Where the spec lists the words, only those stay and anything else is the spec's unknown word (or none, where it has none).
_ACTIVITY = _one_of("active quiet waiting unknown", "unknown")
_ROLE = _one_of("viewer supervisor worker external")
_LAST_VERB = _one_of("working parked needs-decision done blocked paused failed resolved")
_DECIDES = _one_of("supervisor worker")
_PRESSURE = _one_of("normal warn critical")
_GATE = _one_of("pass fail unknown", "unknown")
_TIER = _one_of("pass fail unknown skipped", "unknown")
_RUNWAY = _one_of("through_reset exhausts_before_reset exhausted unknown", "unknown")
_STATUS = _one_of("ok warn down unknown", "unknown")
_LEVEL = _one_of("ok warn critical")
_HEALTH = _one_of("ok draining reserved maintenance lost")
_SEVERITY = _one_of("critical action info", "info")
_ITEM_STATE = _one_of("running waiting done blocked paused failed unknown", "unknown")
_HANDOFF = _one_of("none awaiting_you automatic complete unknown", "unknown")
_AGENT = _one_of("alive ended gone unknown", "unknown")
_LINK_STATE = _one_of("open merged closed")
_PHASE = _one_of("plan build verify ship wait land")
_BASIS = _one_of("history default coarse none", "none")
_STEP_STATUS = _one_of("done current pending skipped unknown", "unknown")
_REPORTED = _one_of("reported")
_COLLECTOR = _one_of("ok stale error disabled")
_COLOR = Word(lambda v: isinstance(v, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", v) is not None)   # the only form the page draws
_VERDICT_STATE = _token("unknown")
_SURFACE = Word(lambda v: isinstance(v, str) and re.fullmatch(r"\w[\w.:-]{0,47}(\[\w[\w.:-]{0,47}\])?(\.\w+)*", v) is not None)   # "items", "machines[atlas].extras"

_LINK = _o("url label state_as_of", state=_LINK_STATE)
_HOLD = _o("until reason since", bucket=_TOKEN_WORD)
_STEP = _o("id label weight elapsed_s typical_s p90_s round", status=_STEP_STATUS)
_MACHINE = dict(
    _o("id label as_of uptime_s on_battery observed_by synthesized sources", status=_STATUS, role=_NAME_WORD,
       reach=_o("probe_ok rtt_ms last_ok_at error"),
       load=_o("l1 l5 cores runq_per_core runq_now psi_some10 busy_pct", runq_basis=_NAME_WORD),
       mem=_o("used_pct swap_used_pct avail_gb total_gb swap_rate_pps swap_rate_pps_1m paging_pps commit_pct compressor_gb "
              "psi_some10 psi_full10", native_pressure=_PRESSURE),
       io=_o("busy_pct psi_some10"), pressure=_o("why", level=_LEVEL),
       beat=_o("seq interval_s age_s errors", version=_TOKEN_WORD, cost=_o("cpu_pct cpu_pct_total cpu_s_per_h rss_mb collect_ms uptime_s "
                                                          "budget_cpu_pct over_budget")),
       health=_o("since reason until source", state=_HEALTH), disks=[_o("label free_gb free_pct warn_gb crit_gb")],
       extras=[_o("label value severity")], lanes=_o("running total homes unreported or_more"),
       beat_seen=_o("at interval_s"), strain=_o("state value baseline threshold since sustained_s warm")))
_MACHINE["stations"] = [{k: v for k, v in _MACHINE.items() if k not in ("stations", "beat_seen", "strain", "lanes", "synthesized")}]
_ATTENTION = _o("id title detail since machine item group how recommend say as_of options source aside debounce",
                severity=_SEVERITY, kind=_TOKEN_WORD, link=_LINK, answer_link=_o("url label state state_as_of why"), actor=_o("name", role=_ROLE),
                hold=_HOLD, verdict=_o("name as_of", state=_VERDICT_STATE))
_ITEM = _o("id owner relayed group machine title doing state_detail started_at needs_you project summary "
           "until waiting_for waiting_since state_since goal source second_hand",
           state=_ITEM_STATE, phase=_PHASE, waiting_on=_TOKEN_WORD, flags=[_TOKEN_WORD],
           kind=_TOKEN_WORD, last_event=_o("state text at"), handoff=_o("since", state=_HANDOFF), link=_LINK,
           reported=_o("label percent at", basis=_REPORTED), agent=_o("since as_of reason", state=_AGENT),
           lane=_o("kind cls until agent_gone_s asks_you", waiting_on=_TOKEN_WORD),
           source_lane=_o("since short_title branch", state=_NAME_WORD, cause=_TOKEN_WORD, last_word=_o("at", verb=_LAST_VERB)),
           say=[_o("step of at until findings n more title", t=_TOKEN_WORD, how=_TOKEN_WORD, gate=_TOKEN_WORD, decides=_DECIDES,
                   verb=_TOKEN_WORD)],
           row=_o("chip title summary order mark"), age=_o("s since basis"),
           progress=_o("history_n percent_floor percent_ceiling regressed reason", basis=_BASIS, steps=[_STEP],
                       current=_o("step elapsed_s typical_s p90_s round last_activity_age_s waiting_since", activity=_ACTIVITY)))
_SOURCE = _o("id label machine station peers received_at interval_s interval_declared mode boot_id seq skew_s generated_at "
             "pushes_24h gaps_24h placeholder reason", kind=_NAME_WORD,
             collectors=[_o("id as_of error warnings label stale_after_s made_at refresh_s", status=_COLLECTOR)],
             rejected=_o("since last_at count reason kind seq boot_id"),
             waiting=_o("verified as_of age_s reason note", basis=_TOKEN_WORD),
             producer=_o("host", name=_TOKEN_WORD, version=_TOKEN_WORD, pusher=_o("", name=_TOKEN_WORD, version=_TOKEN_WORD)),
             skew=[_o("effect newer_source", since=_TOKEN_WORD, newer_version=_TOKEN_WORD)],
             pace=_o("slowed factor why since_s pass_s normal_pass_s keepalive_s normal_keepalive_s load_per_core on_battery",
                     cost=_o("cpu_s_per_h budget_cpu_s_per_h run_s budget_run_s measured_s over_budget")),
             freshness=[_o("id label age_s limit_s state error made refresh_s")])
_GAPS = dict(
    waits_outside=[_o("id source owner title chip waiting_on who since age_s")],
    oldest_waiting=_o("s id source"),
    queues=[_o("id source label machine length held cap oldest_wait_s oldest_since state as_of",
               holders=[_o("label since s")])],
    coming_up=[_o("at date_only date kind id source title word")],
    deploys=[_o("id source label group deployed deployed_at head behind oldest_unshipped_at oldest_s state error as_of")],
    mirrors=[_o("id source machine ns label repo state last_known detail pending nothing_new checked_s limit_s checked_at "
                "changed_at changed_sha failing_since pending_since since note as_of",
                outcome=_TOKEN_WORD, at=_o("checked changed failing pending"))])

# The whole view; `cards` are reduced by level (cards.py), `fleet` and `glance.marks` hold ids and numbers
# the host works out.
VIEW = _o("cards_rejected sample sample_only fleet",
          cards=[_o("tool title status mode updated_at stale_after_s")], sources=[_SOURCE], machines=[_MACHINE], items=[_ITEM], attention=[_ATTENTION], attention_pending=[_ATTENTION],
          next=[_o("id group title blocked_by reason until filed goal source aside", kind=_TOKEN_WORD, hold=_HOLD)],
          done=[_o("id owner group title at goal source", via=_NAME_WORD, link=_LINK)],
          goals=[_o("name lanes next done or_more")],
          groups=[_o("id label", color=_COLOR,
                     checkpoint=_o("as_of source", live=_o("since", version=_TOKEN_WORD),
                                   next=_o("waiting_on items_ready", version=_TOKEN_WORD),
                                                       gate=_o("as_of note sha failing ship", value=_GATE, tiers=[_o("id", verdict=_TIER)])))],
          meters=_o("", accounts=[_o("id machine source as_of", label=_NAME_WORD, provider=_NAME_WORD, account=_NAME_WORD,
                                     windows=[_o("id percent_remaining resets_at", label=_NAME_WORD, short=_NAME_WORD, pace=_TOKEN_WORD)],
                                     runway=_o("projected_empty_at", status=_RUNWAY, confidence=_TOKEN_WORD, source=_NAME_WORD))],
                    chips=[_o("id source countdown_s back_in_s left resets_at resets state sentence forms",
                              provider=_name("?"), account=_NAME_WORD,
                              projection=_o("empty_at", status=_RUNWAY, confidence=_TOKEN_WORD, source=_NAME_WORD),
                              window=_o("id", label=_NAME_WORD, short=_NAME_WORD))]),
          omitted=[_o("shown total reason source", surface=_SURFACE)],
          counts=_o("items running off_course lanes_waiting waiting awaiting_you unknown attention attention_pending waiting_on_you "
                    "calls waiting_unverified next agent_gone outside queued version_skew version_unknown"),
          waiting_disagree=[_o("kind item item_source call call_source")],
          gaps=_o("", **_GAPS),
          history=_o("tz done_today", landed=_o("mode since hours day_start n"), by_day=[_o("day done")],
                     timeline=[_o("at owner item group text", kind=_TOKEN_WORD)], notes=[_o("at source item text")]),
          glance=_o("marks", projects=[_o("key chip n off waiting machines")]))


def project(node, shape=VIEW):
    """`node` cut down to the keys `shape` lists, at every depth, and a `Word` field to a legal word or its fallback."""
    if shape is True or node is None:
        return node
    if isinstance(shape, Word):
        return node if shape.fits(node) else shape.fallback
    if isinstance(shape, dict):
        return {k: project(v, shape[k]) for k, v in node.items() if k in shape} if isinstance(node, dict) else None
    return [project(v, shape[0]) for v in node] if isinstance(node, list) else None


def _chips(view):
    meters = view.get("meters")
    chips = meters.get("chips") if isinstance(meters, dict) else None
    return chips if isinstance(chips, list) else []


def _chip_words(chip):
    window = chip.get("window") or {}
    return chip.get("provider"), chip.get("account"), window.get("label"), window.get("short")


def restrict(view):
    """The view itself, cut down to the keys VIEW lists.

    A chip's `forms` and `sentence` spell its provider, account and window out; when one of those words was not a legal name
    (and so was replaced), they are not kept, and the chip says what is left of its name and its figure, or "?" without one."""
    before = [_chip_words(c) if isinstance(c, dict) else None for c in _chips(view)]
    kept = project(view)
    view.clear()
    view.update(kept)
    for c, words in zip(_chips(view), before):
        if isinstance(c, dict) and _chip_words(c) != words:
            left = c.get("left")
            c["forms"] = [" ".join(x for x in (c.get("provider"), c.get("account"), (c.get("window") or {}).get("short"),
                                               "%d%%" % left if isinstance(left, (int, float)) else "?") if x)]
            c["sentence"] = None
