# Changelog

All notable changes to Weatherdeck (called Lookout until this rename; entries from 0.9.0 on use the new names; earlier sections keep the names and paths in use when they were written). The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
version follows [semantic versioning](https://semver.org/). The feed schema has its own version (`lookout.feed`, see
[docs/feed-spec.md](docs/feed-spec.md)); a feed of any 1.x version is accepted.

## [Unreleased]

## [0.10.5] - 2026-10-21

In plain words: the page no longer says ALL FINE over a collector that failed or is disabled, and the example firstmate and Cua pushers no longer turn a torn ledger or an unknown run into an empty fleet or a zero.

### Fixed: the page no longer says ALL FINE over a collector that failed or is disabled

A source could send a collector as `error` and the board only noted it in small print (the trust line and the Crow's nest) while the
All fine tile stayed lit. A collector sent as `disabled` was read by the host as `ok` (`freshness[].state`), so it was not said at all.
Now `disabled` is its own freshness state, and a collector that failed or is disabled is a line of Problems ("atlas: items failed",
"atlas: items disabled, not read"), so All fine stays dark while any surface is unread. Because it is a Problem, the Bridge says
"Nothing was waiting at the last report" instead of "Nothing is waiting on you" while one is open. A collector that is only old keeps its note.
The feed spec and schema are unchanged; `disabled` was already a legal collector status.

### Fixed: the example pushers no longer turn "unknown" into an empty fleet or a zero

The firstmate pusher sent a ledger with no usable record in it (a file cut down to one torn line, say) as a fresh, empty, successful snapshot,
so every open task vanished and the `items` collector said `ok`. Now a ledger that has lines but no usable record is sent with the `items`
collector as `error` and no rows; an absent ledger still pushes nothing, an empty one is still no rows, and a torn line after usable
records is still a warning. The Cua pusher counted a run whose state is `unknown` (or a status it does not know) as zero running, so a host's
`lanes` said `running: 0`. Now `running` is left out of that host's `lanes`, as it already was for an offline host. A run row that is left out
(no id, or an id repeated from an earlier row) also leaves `running` out for the host its Space is on, and one that names no usable Space
leaves it out for every host. The feed spec and schema
are unchanged.

## [0.10.4] - 2026-10-20

0.10.4 is the first public release since 0.10.1 and carries everything in 0.10.2 and 0.10.3 (read those entries below). The only change in 0.10.4 itself is that the example firstmate pusher's test fixtures use a neutral machine name.

## [0.10.3] - 2026-10-20

In plain words: 0.10.2 made the household (`tv`), guest and public views allowlist projections, so they keep only the fields the host
lists for them. This release closes the remaining gap: a listed field that holds a word, a version or a short name could still carry
a whole sentence, and that sentence reached every redacted view. Those fields now keep only a legal value, and an unknown value
degrades to `unknown` or a blank. Names keep a short, plain shape, so a few words of text in a name field (a machine, source or group
label) still pass by design; a host must not put private text in a label. The default install (loopback, one listener, no tokens) is
not exposed across a boundary by this.

### Fixed: a sentence can no longer ride in a field that holds a word, on the household (`tv`), guest and public views

The previous fix kept only the fields the host lists, but a listed field was kept whatever it held. A field that is only meant to
hold a word, a version or a short name (a lane's activity, a call's kind and severity, a hold's bucket, whose turn it is, a lane's
cause, last word and state, the parts of a lane's sentence, an item's, a machine's and an agent's state, a release gate's verdicts, a
machine's role, status and pressure, a source's kind, collectors and versions, a group's colour, and a meter's provider, account, windows and
runway) still accepts any text in a feed, so a source could put a sentence there and it reached every redacted view. Those views now
keep only a legal value in each of them: where the feed spec lists the words, anything else becomes `unknown` (or nothing where the field
has no unknown word, as for a last word or a phase); otherwise one word or a short name stays and a sentence does not. A meter chip
whose name was replaced is worded again from what is left, without its running-out sentence. The names the board draws as an entity's
own (machine, source, group, project, station, queue, deploy, collector and folder labels) stay as sent: some have no id to fall back on,
and a row's chip, the glance and the coming-up list copy them. The full view, and what the views show for every legitimate value, do not
change.

## [0.10.2] - 2026-10-20

In plain words: before this release, the household (`tv`), guest and public views could show private text that the host had not
listed for them: a machine's pressure reasons, a feed's own extension fields at any depth, and the reasons a list was cut (the
household and guest views also showed history notes). The default install (loopback, one listener, no tokens) was not exposed
across a boundary by this. Now each of those views is an allowlist projection: it keeps only the fields the host lists for it, and
anything unlisted stays private. This release also rejects a feed that would poison the saved board, and adds two example pushers.

### Fixed: the household (`tv`), guest and public views keep only the fields the host lists for them

A redacted view was the full view with chosen fields blanked, so a field nobody had thought to blank came through. A feed's own
extension fields (any key the schema does not name, which the host passes through) were in every redacted view, as were a machine's
pressure reasons (`pressure.why`), the reason a list was cut (`omitted[].reason`), a source's reasons for slowing (`pace.why`) and the
sentence an adapter gives for a version gap (`skew[].effect`); the household and guest views also carried the Logbook's note text. Each redacted level now keeps only the keys `src/weatherdeck/allowlist.py` lists, so an unknown or later field
is private until it is listed, and those four are gone from all three levels (the page shows a machine's pressure level without its
reasons, a slowed source without its why ("no reason given") and a version gap without its sentence, and no notes on the household and
guest views, as the public view already had none). The guest view also carried every add-in card whole (headline, numbers, link and
title); it now keeps a card's tool name, status, mode and age, as the household view does without the title.

### Fixed: a feed with a null list entry or a non-finite number no longer poisons the board

A push of `"items": [null]` (or a null in any list of objects) was refused as an internal fault after its source file had
already been written, so every later view of the board failed with a 500 and a restart read the same file. A `NaN` or
infinite number in `machines[].extras[].value`, or in any unknown extension field, was accepted and sent on in the view as
`NaN`, which a browser cannot parse. Both are now rejected at validation (code 65), and the source file is published only
after the history, norms and alerts it feeds have been worked out, so a push that is refused or faults leaves the previous
feed in place.

### Added: a pusher for a firstmate home (`examples/adapter/firstmate_push.py`)

An example adapter that puts a firstmate home on the board from the two files that home documents for outside readers: its fleet
ledger (`state/fleet-ledger.jsonl`, `fleet-ledger.v1`) and, when it exists, `state/lane-capacity.json` (`fm-lane-capacity.v1`). Standard
library only, read-only, no model calls. `task.dispatched` and `task.status` become `items[]` (the status word sets `state`; the line's
text goes to `doing` or `state_detail`, never `summary`), `task.pr_ready` a `link`, `task.merged` and `task.cleaned_up` a `done[]` row (a cleanup with no merge before it is titled "cleaned up,
no merge recorded", with no `via` or link, so nothing is shown as landed that the ledger does not say landed); the lane-capacity file
gives the machine's `lanes.total` and `pressure`. The ledger records no liveness, so every row says `agent.state: unknown`; repeated
records are one task, one state and one `done[]` row; with no ledger it pushes nothing, so the source reads as silent; and lanes the
home counts that the ledger cannot show are declared in `omitted[]`.
Uses feed 1.12 fields only; nothing in the host or the page changed. README, "Feed it from a firstmate home".

### Checked on
- `python3 -m unittest discover -s tests` and `python3 -I scripts/self-audit`; the new tests (`tests/test_firstmate_push.py`, fixtures in
  `tests/fixtures/firstmate/`, one of them written by firstmate's own ledger writer in a scratch home) on Python 3.9.6, 3.11, 3.13 and 3.14.
- Not checked: a live firstmate home pushing to a live host over a day; the lane-capacity producer was not merged in firstmate when this was
  written, so its file shape comes from that branch's documentation and a synthetic fixture.

### Added: a pusher for Cua Spaces (`examples/adapter/cua_push.py`)

- **Cua Spaces and their agent runs on the board**, from the `cua` command's `--json` output, read-only and polled every 60 s (never below 30).
  A host is a machine with its Spaces in `extras` (an offline or not-sharing host is `down`, never ok); a run is a lane whose word and
  cause come from Cua's own status (`cua-run-crashed`, `cua-run-failed`, `cua-run-running`, and so on); an access request or a run failure is a call;
  a turn end is an event; usage is one allowance chip with the runway unknown. Cua reports no load, memory or disk, a run's percent, or
  a run's state on an offline host, so none of those is sent. A missing cua, a cua nobody is signed in to, a command it lacks and an answer of
  an unexpected shape each have a plain outcome ([docs/cua.md](docs/cua.md)).
- **Not checked against a live cua**: it was not available. Every command and field shape is assumed from Cua's published description, and
  the fixtures in `tests/fixtures/cua/` are hand-written, not recorded. Cua's tool contract (v0.7.0) is experimental, and whether polling counts
  against a plan's limits is not documented. The relay (`relay.cua.ai`) can read what it proxies: prefer `direct:` Spaces.
- `tests/test_cuapush.py` (see CONTRIBUTING.md, "Tests"). No feed field is added: it sends feed 1.12 as it stands.

## [0.10.1] - 2026-10-16

### Fixed: a theme changed by the page address while the crow flies

On the TV's sea, changing `#theme=` at the moment a call's crow was flying to the call plate (the first seconds after a load
with calls waiting) threw "Cannot read properties of null" ten times a second until the flight's time ran out, in every
browser: the new theme has no crow, and the flight kept drawing one. The flight now ends when its sprite is gone.

### Changed: Firefox and WebKit are checked headless, and the README says what was seen

The Support table's Firefox row said "expected to work"; it now says what a headless check found, and the Safari row says
which WebKit was run. A new Known issue: headless WebKit does not draw the page board's sea panel at 1440 px and wider.
[docs/device-checklist.md](docs/device-checklist.md) has the commands ("Firefox and WebKit headless check").

### Checked on
- Headless Chromium 156, Firefox 157 and WebKit 27.2 (Playwright 1.64.1, on Linux under WSL2, software rendered), one at a
  time, at 1920 x 1080 and 390 x 844 (DPR 3; Firefox without phone emulation), on `weatherdeck run --demo`: the front door
  (the sea on the TV, the page board on the phone), the Lists door, the Deferred and someone-else's-turn fold, Read all,
  worker notes, Copy (the button says "Copied" in all three), the key and Esc, `#theme=ship-deck` and `default`,
  `#preview=lost`, `late`, `host` and `empty`, `#night=1`, `#controls=1` and a button in it, the `tv` view, and the static
  demo. No sideways scroll anywhere, every self-hosted face loaded, no failed request and, after the fix above, no page
  error in any engine. The only console lines are WebKit's refusal of Playwright's own screenshot style by the content
  security policy (none without a screenshot).
- Differences from Chromium: WebKit leaves the page board's sea panel empty at 1920 and 1440 px (the lists' columns; 390 px
  draws it), and Firefox's system face on Linux is a few pixels wider, so one call line on the `default` theme's sea ends in
  an ellipsis where Chromium's fits. Everything else matched, step by step, in the screenshots.
- Not checked: a real Safari, iPhone, TV, or a desktop Firefox on a real screen.

Also in the source repository, not in the release zip: the hosted test workflow's job now times out after 11 minutes.

## [0.10.0] - 2026-10-16

### Added: what is deferred or someone else's turn, beside "Needs you" (feed 1.12)

- **A folded section under "Needs you"** on the page board (and on the Bridge, under DEFERRED and SOMEONE ELSE'S TURN): the viewer's dated
  holds that still hold, each with its date and reason, and the cards that are someone else's turn (the supervisor's blocked notices, a
  change held for the release train waiting on a verdict, a stale-summary notice), each with whose it is, since when and the verdict it waits
  on. Neither group is ever counted in the waiting-on-you number, and a hold comes back as a call the moment its date passes.
- **Feed 1.12, optional fields only**: an attention card's `actor` `{role, name}`, `hold` `{bucket, until, reason, since}` and `verdict`
  `{name, state, as_of}`; a `next[]` row's `hold`; a machine row's `lanes` `{running, total}`; a lane's `branch`; a collector's `made_at` and
  `refresh_s`. A feed without them reads exactly as before. The host sets `aside` (`deferred` or `theirs`) on cards and queued rows and leaves
  them out of `counts.waiting_on_you`, `counts.calls`, the "since you last looked" call marks and a lane's `needs_you`.
- **Lanes per machine across every home**: the host adds every source's own `lanes` count for a machine (`machines[].lanes` `{running, total,
  homes, unreported, or_more}`), so two homes on one machine are one count; the machine row says "lanes 3 running of 5 · 2 homes". A home silent past `lost_after_s` is
  not added: it is unreported and the count says "or more".
- **A copy's made age**: a collector with `made_at` is aged from its maker's own stamp, not from when it was read, so a summary that is
  re-touched without being remade still grows old; past its limit it is a Problem and leads the trust line ("made 40 min ago and is
  remade every 5 min: STALE"), and the Crow's nest says the made age while it is fine.

### Changed: rows say what is recorded, in whole titles

- **Whole titles**: a lane row shows the item's whole title, wrapped, instead of the source's short title; a place that must fit one line
  (the TV log) still cuts it at a whole word.
- **Can't tell only when nothing is recorded**: a lane whose state cannot be read but whose last word was done or paused says what its record
  holds (its PR open: "Finished; waiting on upstream review", or "Paused; its PR is waiting on upstream review" after a paused last word;
  merged; a hold; or "Branch only, no worker running"); a Can't tell row with a
  recorded last word leads with that word and its age, and "can't be read" is said only when nothing it said is recorded.
- **FYI in plain words**: each FYI says what kind of notice it is and whose it is ("whose it is: not reported" without a 1.12 `actor`).
- **Sources disagree, both sides**: each line says what the one source says and what the other says or does not say about the same ask.
- **The demo** carries synthetic 1.12 data: a deferred call and queued row, the supervisor's cards (one waiting on a verdict), an FYI with its
  owner, a second home's lane on the primary machine, two Can't tell lanes whose record says more, and a fresh and a stale made copy.

### Fixed: the log header's landed count is the bar's landed score

- The sea view's log header could say "0 LANDED" under a bar that said "6 LANDED, LAST 24 H": the header counted only the listed lanes that had
  finished, while the bar counts the work that landed in its window. The header now shows the bar's number, as the calm line already did; the phone,
  whose bar has no score, adds the window ("6 LANDED IN 24 H").

### Changed: README pictures, and the hosted test suite passes on Windows, macOS and Linux

- **README pictures**: a TV-sized hero, a short list of what you see, a tour clip (with a still frame beside it) and a phone shot, all taken from the
  demo, whose sources are invented. The README's test table says what the hosted runs were and were not (the hosted Windows image is Windows Server,
  not Windows 11).
- **The hosted test run**: all 453 tests pass on GitHub's hosted Ubuntu, macOS and Windows runners on Python 3.9 to 3.14 (run by hand on 2026-10-16;
  the first run failed 13 tests on every Windows leg). The fixes are in the tests and in `scripts/merged-check`, not in the board: the page-script
  tests send the Node harness its data on stdin instead of the command line (Windows refuses a command line over 32,767 characters) and decode its
  answer as UTF-8 (a cut title's ellipsis came back as three other characters under the Windows code page); the doctor tests' simulated Linux
  machine answers an interpreter path and file modes the way a Linux machine does; and `scripts/merged-check` removes its scratch clone even where
  git's object files are read-only (Windows).

## [0.9.0] - 2026-10-16

### Changed: a silent feed reads as silent, with the machine's liveness from its beat

- A source that went quiet now says how long, against the interval it declares ("Late 1 min (missing after 4 x 20 s)", "Silent for 6 min (missing after 4 x 20 s)"), on the Sources list, in the evidence line, on the machine row and in the trust line. A source that declares no `interval_s` says "interval not declared" and is never called late or missing.
- The machine behind a silent source says what its beat shows: "machine last seen 40 s ago via its beat", "machine not seen for 20 min, its beat is silent too" (the beat stopped as well), or "machine not seen" (no beat was ever seen). Silence alone never reads as down.
- The view gains two derived fields (no new feed field): a source's `interval_declared` and a machine's `beat_seen`. The wording is in `defaults.json` (`src_say_*`, `machine_seen_*`, `machine_unseen`).

### Added: Linux lingering preflight, a beat with every join, a doctor check

- **`weatherdeck join --dry-run` checks lingering** on Linux (not WSL, nor a host without a systemd user manager unless `--scheduler cron` or `system` is chosen). A systemd user unit is stopped when the
  last login session of its user ends, unless lingering is on, and returns only at the next login, so the board shows the machine missing in between.
  With lingering off the plan is not ready (`LINGER_OFF`, with the one-line remedy `loginctl enable-linger <user>`); a lingering state that could not be read
  is `LINGER_UNKNOWN`, never a pass. `--scheduler cron` (a crontab line) or `--scheduler system` (a system-level unit) is the named alternative and does not
  need lingering. The join never changes lingering, and removing it leaves lingering as found. An adapter's pusher that is a user unit is named at risk too.
- **Every join plans the beat** (`beat-<machine>`, docs/beat.md) beside any adapter pusher on the machine, registered the same way and under the same lingering rule.
  The dry run prints that plan, what it leaves alone and how to undo it.
- **`weatherdeck doctor` has one more check, `systemd user timers survive logout`**: lingering and the next elapse of a Weatherdeck user timer; `warn` with the
  remedy when lingering is off, not applicable on macOS, Windows and hosts without systemd. Advice only; doctor never runs `enable-linger`.

### Changed: open-source text

- MIT licensed (see LICENSE); README, CONTRIBUTING, SECURITY, SUPPORT and CODE_OF_CONDUCT (Contributor Covenant 2.1) carry real text, with reports routed through GitHub's private vulnerability reporting and issues, and no placeholders left.

### Changed: the demo never shows this machine's name, and the README gives the demo's silence its real timing

- **`weatherdeck run --demo` serves as "demo host"** when `hosts.label` is not set, where it used to show the machine's own hostname on the page. A configured `hosts.label` still wins, and a real (non-demo) host still defaults to its hostname.
- **README: the demo's silent source** stops reporting after about two and a half minutes, shows late from about 2:40 and silent about three minutes after start (the README had put silent at two and a half minutes).

### Removed: the bundled adapter left this repository (the product and the feed are untouched)

- **`adapters/` is gone.** The tool-specific adapter that lived there (its pusher, replay, installers, host preset, runbooks, fixtures and its
  own tests) is kept and built in its own repository now. Nothing a running install uses changes: every machine runs an installed copy, and
  the next package comes from there under the same names and layout. To feed the board from your own tool, see
  [docs/adapters.md](docs/adapters.md); [docs/runbook-windows.md](docs/runbook-windows.md) and [docs/runbook-macos.md](docs/runbook-macos.md)
  are the host guides.
- **`scripts/build-package` builds the product zip only** (`weatherdeck-<version>.zip`). It no longer reads `adapters/*/packages.json`; a
  package that bundles an adapter (its pusher, or a host package of the product plus the adapter's files) is built from the adapter's
  repository, which runs this script for the product part.
- **`scripts/self-audit` exempts nothing by default** (it used to skip `adapters/` in the vendor check; `--exempt DIR` still marks an adapter
  directory), and `--denylist` can be given more than once. Its built-in vendor list keeps only the generic AI-provider and VPN names; the names of
  tools the core meets only through an adapter belong in a private denylist kept outside the tree.
- **`MIGRATION.md` is gone.** The schema-id table (why the wire ids still say `lookout.*`) is now the "Schema ids" section of
  [docs/feed-spec.md](docs/feed-spec.md), with the ids unchanged.
- `scripts/merged-check`, the CI workflow, `CONTRIBUTING.md`, the README and the pull request template no longer mention the adapter's suite,
  replay or directory: the core suite (`python3 -m unittest discover -s tests`) is the one suite here.

### Changed: a merged PR is never trouble or an ask, and old records fold under Housekeeping (readability slice 3; the feed is untouched)

- **No agent gone after a merge.** A lane whose PR merged is never `agent_gone`, whatever its state says (`src/weatherdeck/lanes.py`
  `agent_gone`). A lane paused after its PR merged, whose worker's session then ended, read AGENT GONE and was counted off course;
  the exemption covered only a failed, done or unknown state, as the feed spec's "No agent at the work" already promised for any state.
- **An approval whose PR merged or was closed is an old record.** It was already left out of the waiting-on-you number; its row no
  longer reads Waiting on you or Finished among the live rows, and its sailor is not at the rail.
- **Housekeeping holds every old record the board can tell from the feed alone**, each with its reason as its sentence: an old approval
  ("Old approval: PR #1 merged, nothing left to approve."), a lane whose PR merged and whose worker's session ended without the lane
  being closed ("Finished but never closed: ..."), and the rows that read Can't tell only because their books are old ("Old record:
  ..."). The Lists page folds them under "Housekeeping: N old records", closed until tapped; the phone's list ends with the same fold; the
  sea's "+N more" line counts them as "N old records". None of them is counted as waiting on you, off course (including a project's head
  on the Gun deck), a trouble badge, the Gun deck door's outline, a Problems line, the waiting count or the waits outside the fleet, and the page never closes or
  changes any of them. Words are `hk_*` in `labels` (the `rs_approval_merged`, `rs_approval_closed`, `rs_gone_merged` and `rs_unread`
  sentences are now `hk_approval_merged`, `hk_approval_closed`, `hk_gone_merged` and `hk_unread`). The host's `counts.off_course` still
  counts an old record whose only sign is its books' words, which only the page reads. See [docs/theme-spec.md](docs/theme-spec.md) 24.3.

### Changed: approval lanes join the waiting-on-you number, one ask is one line, and a "sources disagree" badge (readability pass, second part)

- **A lane that waits for your OK is counted.** A lane that says it waits for the viewer's OK (`handoff.state: awaiting_you`) with
  its PR open (`link.state: open`), and that no call names, is an ask of its own: it joins the one waiting-on-you number on the
  call band, the Lists header, the Bridge door and the ship plates, and is drawn as its own line ("Waiting for your OK: <title>")
  with its own reason ("Its lane says it is waiting for your OK; <source> has not raised it as a call", naming the source that
  raised the calls when exactly one did). A raised call keeps its own reason line. A lane whose PR merged or closed is not counted.
- **One ask is one line.** A call whose `item` names the lane, or, with no `item`, whose `link.url` is the lane's `link.url`,
  absorbs the lane. The host decides it (`src/weatherdeck/view.py` `lane_asks`) and marks the lane `lane.asks_you` in `/api/view`;
  `counts.waiting_on_you` counts the calls plus those lanes.
- **The number says how old it is**: "as of 3 min ago" beside it on the call band and the Lists header, from the oldest report
  behind its asks (`counts.calls_snapshot_at` when the view carries one, else when the host received each feed); "as of: not
  reported" when no ask has a known time.
- **"Sources disagree".** When the calls and the lanes that say they wait for the viewer's OK report different sets (a lane no
  call names, or a call whose lane does not say it waits), a small badge sits beside the number, and its detail lists each
  difference: under the Lists header, under the calls on the band, and on the Bridge under "Sources disagree". The view lists them
  as `waiting_disagree`. Nothing in it is counted, and the board closes nothing.
- The Bridge heads the lane asks "Lanes waiting for your OK"; its rows no longer squash when the list is longer than the place,
  the list scrolls instead.
- A call or lane ask with no start time says "Waiting since: not reported" on the Lists page (was "Waiting ?").

### Added: an instruction left unread says so on its lane's row (readability slice 12, the page half; the feed spec is untouched)

- **An idle lane with an unread instruction shows one amber line** on its row on the sea's log, the page board and the Lanes deck:
  "An instruction from atlas has sat unread for 25 min" (`web/frontdoor.js` `steerNote`). An instruction whose doorbell never
  reached the worker says so whatever the worker is doing: "An instruction from atlas was never delivered (12 min ago)". A line
  the source marks escalated sorts with Stuck. The opened row says how many wait unread, the oldest's age, how often it was
  rung and whether the worker is idle.
- It reads only fields a source may send on its own lane word, proposed and not yet in the feed spec: `lane.unread_steer`
  `{n, oldest_at, rings, escalated}` (null: it looked and found none), `lane.undelivered_steer` `{n, oldest_at}` and `lane.idle`.
  No source sends them yet. A source without them says nothing about unread instructions on its rows, and its opened row says
  "Unread messages: not reported", never 0. Words are in `labels` (`steer_*`). See [docs/theme-spec.md](docs/theme-spec.md) 9.5 and 24.2.

### Changed: one sort on the sea and the Lists page (readability slice 6; the feed is untouched)

- **Both front doors list the lanes in the same order**: Waiting on you, Stuck, Can't tell, Working (by project), Waiting on someone else,
  Finished, and the old records last. The sea led with the oldest failed record and the Lists page with what waits on you, so they disagreed
  about what comes first. One function (`web/frontdoor.js` `sortRows`) and one list (`display.row_sort` in `defaults.json`) now order both.
- **Longest-waiting first** inside Waiting on you and Stuck, from the host's age in state; a row with no age follows the rows that have one
  and says nothing of how long.
- **An old record never sorts above live work.** A row that reads Can't tell only because its books are old goes last, and on the Lists page
  into a folded "Housekeeping: N old records" line. It is drawn calm on the sea, and is not counted off course (the log's header, the phone's
  list, a ship's trouble badge); the "+N more" line counts it as "N old records".
- The Lists page is now one card for each row word, with the goal and project cards where Working falls (each still counts all its lanes);
  the sea's log is one list, and its "+N more" line counts the rest in the six words (`log_overflow`, `log_on_more` and `log_rest` are
  now `log_more`).

### Changed: one waiting-on-you number, and alarms out of it (readability pass, first part)

- **The Bridge door counts the calls only.** It counted the critical alarms too, so it could say "6 wait on you" beside a call band
  of 5. The call band, the Lists header, the Bridge door and the ship plates now show one number, from one rule (`web/frontdoor.js`
  `cardTier`, `waitingOnYou`): every attention card that is neither critical nor info.
- **The host says the same number** as `counts.waiting_on_you` in `/api/view` (one per ask; `counts.calls` is unchanged).
- **A critical is a Problem, on its own line, never counted.** The sea's alarm bar and a place's bar say "Problem" (was "Critical"),
  the Bridge heads it "Problems", and the Lists page's second list is now **Problems** (was "Needs attention", which read like the
  waiting number beside it).
- **An info card is an FYI, never counted.** The call band and the calm plate say "FYI:" before it (was "Also:", which an
  unverified share of the number keeps), and the Bridge lists it under its own "FYI" heading.

### Changed: the supervision alarm says whose it is and how old, and is critical only on evidence (readability, page only; the feed is untouched)

- A `service:supervision:<source>` card's title names the home by its source's name and says its heartbeat's age in words
  ("cinder's supervisor hasn't checked in for 6 min") instead of "supervision is not beating"; how to act names the home
  too, never "this home". A card whose `detail` carries no age says "for how long: not reported".
- The page sets the card's severity. With no `supervisor` object in the feed (none sends one yet) the card is FYI with
  "busy or stopped? not reported" while its heartbeat is younger than `thresholds.supervision_stale_critical_s` (1800 s) or
  its age is not reported: the watcher-down marker such a card may be raised on is written on every ordinary wake. A
  heartbeat at least that old stays critical, "hasn't checked in for 40 min (no busy marker reported)". With one, it is
  critical only when no watcher runs and the oldest unacknowledged wake is older than
  `thresholds.supervision_wake_limit_s` (300 s); busy reads "busy in a long turn". See [docs/theme-spec.md](docs/theme-spec.md) 9.3.

### Changed: plain rows and titles that read on the front door (readability slices 4 and 5; the feed is untouched)

- **Every lane row says one of six words and one sentence**, on the sea's log and on the page board (the phone's front door):
  Waiting on you, Stuck, Can't tell, Working, Waiting on someone else, Finished. The word comes from the host's `lane.kind` and the
  source's own lane word (`web/frontdoor.js` `rowState`); the sentence from the source's `say[]` parts, or, for a feed with no lane
  word, from its structured fields only. No row shows "run failed", "superseded", "harness", "unknown missing" or a task id, and the
  log's "+N more" line counts in the six words.
- **An old failed record no longer reads FAILED.** A lane with no lane word whose only lines are its books' "status-log superseded"
  or "harness state unavailable" reads Can't tell with its last news and when; a lane whose run failed or whose worker's session
  ended while its own records say it was waiting reads Waiting on someone else; a merged PR reads Finished. The page board's Needs
  attention list follows the row words.
- **Titles cut only at a whole word**, never leave a bracket open and never fall to one word: the project chip gives way first
  (`fitTitle`). A title the source already cut loses its partial last word; no title reads "title not reported", never the task id.
- The words "run failed" in the page board's sentences read "its last checks failed". All words are in `labels` (`row_*`, `rs_*`,
  `rcount_*`, `title_not_reported`).

### Changed: the bundled adapter's tests moved next to it (tests only)

The 93 tests that load or run the bundled adapter now live in `adapters/*/tests/` and run with
`python3 -m unittest discover -s adapters/*/tests`. The rest of `tests/` needs nothing under `adapters/` and passes with it
deleted. Five files were split by class (`test_boardlink`, `test_goals`, `test_lanestate`) or by test (`test_calloptions`, `test_stalecalls`); three
moved whole (`test_quotause`, `test_pusherhonesty`, `test_replayschema`). The adapter's tests take the core from this repository's `src/`, or from
`WEATHERDECK_SRC`, and stop with a message when neither has it. The CI workflow and `scripts/merged-check` run both suites. No code and no
behaviour changed, and no test was added or removed.

### Added: `waiting.note`, the card that explains an unverified waiting number (feed 1.11, adapter 1.23)

- **Feed 1.11** adds one optional field to `waiting`: `note`, the id of the source's own attention card that says why its waiting number is
  unverified ([docs/feed-spec.md](docs/feed-spec.md)). The page already shows that source's "unverified" line with its reason, so it drops the
  card whose id equals `note` (the same source's only) and no other. Before this the page found that card by matching an id prefix that
  only the bundled adapter used; any source can now name its own. Additive: an older host ignores the field, and a source that sends none
  behaves as before. Without `note` the page lists that card as well as its own unverified line, so the same fact reads twice until the
  source sends `note`; nothing is hidden and no number changes.
- **Bundled adapter 1.23** sends `waiting.note` (the id of its "waiting on you is unverified" card) while its waiting number is unverified,
  and says in `producer.meaning[]` what an older copy cannot do. A machine still on 1.22 or older shows the card twice, as above, only while
  its number is unverified. The board's other cards and numbers are unchanged.

### Changed: the host guide is generic, and an example host config ships (docs and an example only)

[docs/runbook-windows.md](docs/runbook-windows.md) now covers what a Windows host needs without any fleet detail: a config to start from, host names
(`hosts.allowed_hosts`), privacy mode with a two-line double-click recipe, health checks by hand (`/healthz`, `weatherdeck-check`,
`weatherdeck received --summary`), the received log, removal, and a troubleshooting table (the Startup-folder fallback, the firewall on
Private networks, the wrong `authorized_keys` file, a source id that does not match, `403` host names, privacy). New
[examples/host/config.example.json](examples/host/config.example.json) is that config with neutral values (a VPN range for the full view, a home LAN
range for the `tv` view, quiet hours, `may_sleep`, one alias), and `tests/test_hostexample.py` loads it through the config loader and checks that
every key is one the host reads and that its bind entries are accepted. Words that named one fleet in `docs/beat.md`, `docs/device-checklist.md`,
`docs/feed-spec.md`, `docs/hosting.md`, `docs/runbook-windows.md` and `docs/theme-spec.md` now read "the host", "a Windows PC", "the owner" or "the
maintainer". No code and no behaviour changed.

### Fixed: the layout replay fails when it cannot check the schema (adapter tooling only; the feed is untouched)

The bundled adapter's `weatherdeck-*-replay` checks each replayed feed against the core's schema, but when it could not import `weatherdeck.schema`
(a copy of the adapter directory without the core beside it) it skipped that check without a word and printed
`26 snapshot(s), 0 failed`. It now takes the core from `WEATHERDECK_SRC` (the core's `src/`), else `../../src`, and when that core does
not import the schema it exits 2 before it records or replays anything: with `cannot validate feeds: core not found`, or, when
`WEATHERDECK_SRC` is set, with `cannot validate feeds: WEATHERDECK_SRC=<path> has no weatherdeck/schema.py` (a set but wrong
`WEATHERDECK_SRC` no longer falls back to `../../src`). An installed or
`PYTHONPATH` copy of the core is not used in their place. With the core found, nothing changes. Covered by the adapter's `tests/test_replayschema.py`.

### Added: `docs/adapters.md`, "Write a pusher for your tool"

- What an adapter reads, maps and pushes; the wire schema in brief; the sinks file and the three transports; the honesty rules for
  adapters (unknown is not zero, never guess, say how old a reading is, silence is a state); and how to test one without the real
  tool by recording the files it reads and replaying them, including the broken ones. The README points to it.

### Changed: neutral words in core prose and code comments (no behaviour change)

- Comments and docs in the core say "the owner", "the viewer" or "the source's own count" where they named a person or a private
  tool. The demo's hold cause is now `owner-hold` (was a word naming a person), in `examples/demo/atlas-main.json` and the
  re-recorded `examples/static-demo/recorded-feed.json`. No feed field, schema id or screen text changed.

### Added: `weatherdeck invite` and `weatherdeck join --dry-run` (adding a machine, first part)

- **`weatherdeck invite --machine ID`** (on the host) mints a push token for the new source (default `beat-<machine>`) and prints
  one join string carrying the host's address, the source and machine ids, the expiry and the token, shown once. It refuses an id
  that already has a token or reports (`ID_TAKEN`), and replaces an invite still open. The invite is recorded in a small registry,
  `<data>/invites.json` (no token or hash in it; format in [docs/onboarding.md](docs/onboarding.md)).
- **The host enforces the expiry** (`--ttl`, default 15 minutes): until it accepts a first push from the source, a push with its
  token is refused with HTTP 401 "this invite expired ..." once the TTL is over. After a first accepted push the token is an
  ordinary source token. No new route; `weatherdeck token revoke <source>` withdraws an invite and drops its entry.
- **`weatherdeck join --dry-run`** (on the new machine) runs the preflight only and writes nothing: Python 3.9 or newer, on Windows a
  real interpreter and never the Microsoft Store alias (`STORE_ALIAS`), a service manager, write access to the config and state
  folders, earlier beat installs, the host's address (refused, timeout, name not resolved) and name (`HOST_NAME_REFUSED`), its
  clock (`CLOCK_SKEW`, a warning only), the token through a probe that stores nothing (411 good, 401 refused or expired), and
  whether the source id is taken or the machine id disagrees with what this computer already reports as (`MACHINE_ID_DIFFERS`, the
  WSL `-wsl` case). Each failure is named with one next step. The string is read from a hidden prompt or stdin, so the token stays
  out of the process list. Installing the service, the first push and the verify line come later.

### Added: `weatherdeck doctor` and `doctor --host` say why a machine is not on the board

A machine that pushes and does not show on the board had no single place to ask why. `weatherdeck doctor`, run on that machine, checks its
join config (or `--url`, `--source` and `--token-file` for a beat set up by hand), the service it runs under (a systemd user unit, a
LaunchAgent or a logon task, read with query commands only) and that the service names a real interpreter (`STORE_ALIAS` for anything
under `\WindowsApps\`, `BARE_INTERPRETER`, `INTERPRETER_MISSING`), the token file (there, not empty, mode 0600; the token is never
printed), the host (`HOST_UNREACHABLE (dns|refused|timeout)`, `HOST_NAME_REFUSED`), **whether the host accepted a push from this source
within three intervals by the host's own clock** (`NEVER_RECEIVED`, `REJECTED` with the host's reason, `SILENT`), the beat file's `push`
state (beat 1.2) or an adapter pusher's sink state when one is named, clock skew and version skew. `weatherdeck doctor --host` reads the
host's data directory: invited sources never seen (`invites.json`, when there is one), sources and addresses whose last push was refused
(the rejected records and the refusal lines in `server.log`), push tokens never used, and loopback pushers that are refused now or will be
at the first token. Both are read-only, print one line per check and an overall line, and say `not checked: <why>` for a check they
cannot make, never `ok`. The machine side exits 0 only when the host's receipt proves the source live. Linux is checked for real; the
macOS and Windows service readers are tested from injected answers and still need a real Mac and Windows PC. See
[docs/doctor.md](docs/doctor.md). No feed, beat or pusher change, and no new route on the host.

### Added: `scripts/merged-check`, and one statement of the supported Python versions

`scripts/merged-check` merges a branch onto the current `origin/main` in a scratch clone outside the repository (nothing in your checkout is touched), then runs the self-audit, the full test suite and the adapter layout replay on the merged result and prints one verdict line. It exists because two branches that each pass their own gate can be red together, and there is no hosted CI to look at the merged result. CONTRIBUTING and the pull request template now put it in the definition of done. Python 3.9 to 3.14 is now stated the same way everywhere (README, `pyproject.toml` with classifiers, CONTRIBUTING, the manual workflow matrix, hosting, the beat and the runbooks), and 3.8 is not supported; the bundled adapter's two install scripts are unchanged by this and still accept 3.8. Nothing in the board changed.

### Changed: README first-run wording and neutral ledger names (docs only)

The README now says what the board is not (not a monitoring or alerting system, not hosted, pre-release), how to get the code (clone the repository, or unzip what `scripts/build-package` builds), where the config file lives (`<data>/config.json`, with a minimal `hosts.bind` example), why the example schema id reads `lookout.feed`, how to remove it, and that Python 3.9 to 3.14 was tested and 3.8 is not supported. "By the captain" in the device table reads "by the maintainer". [docs/ledger-spec.md](docs/ledger-spec.md) and [docs/ADDINS.md](docs/ADDINS.md) name the tools `infirmary`, `lodgings` and `seaworthy` and state once that `doctor`, `harbor` and `preflight` are accepted as aliases; no behaviour changed.

### Fixed: the pusher's verify commands tell the truth (adapter 1.22; the feed is untouched)

Three ways a new machine looked fine when its host was not taking its pushes:
- **`push --once` no longer goes quiet while a host is being retried.** A host whose last try did not get through is skipped until its
  backoff ends; that pass printed nothing and exited 0, which is what a person sees when they run the documented verify command right after
  a refusal. It now prints one line, `tower: waiting (backing off, next try in 52 s; last: Permission denied (publickey).)`, and the run exits
  1 unless every enabled host is ok (or has nothing due). A run the pace slows on purpose prints the same line under its `slowed` line
  for each host whose last state is not ok, and exits 1 too. `--force` is unchanged.
- **A host that turns the key away is `refused`, not `down`.** ssh's exit 255 with `Permission denied` now reads as `tower: refused ...` and logs
  `credential refused`, like an http host's 401 or 403. Any other 255 (unreachable, host key not matching) stays `down`. Backoff and seq handling are
  the same as for `down`.
- **`check` asks the host.** For an ssh sink it runs `weatherdeck-check` (the one other command a forced-command key may run; it sends and changes
  nothing) and prints `ok    sink tower: the host accepted this key (...)`, `FAIL  sink tower: the host refused this key (...)`, or `FAIL ... could not
  reach the host ...; whether it accepts this key was NOT tested`. For an http sink it POSTs with no `Content-Length` and no body: `411` means the
  credential passed, `401` that a token is required (none sent) or not taken, `403` that the host has no tokens yet; the host answers before it reads
  a body or writes its received log. `check --no-host` skips the question and says `NOT tested`; both installers (`install.sh` for Linux and for the Mac)
  pass it, because they run `check` before the host has the key and a refusal there must not stop the timer from being enabled.
A timer or launchd job that runs `push --once` now exits 1 on every pass while a host is down, not only on the passes that try it. The pusher
version is 1.22 (no `MEANING` entry: nothing the feed carries or means changed). See the bundled adapter's README (`adapters/<adapter>/README.md`).

### Fixed: the zips carry the community files their documents link, and the README names no script they lack

`scripts/build-package` left `SECURITY.md`, `SUPPORT.md` and `CODE_OF_CONDUCT.md` out of the product zip (and so out of the tower zip, which carries the product), while `CONTRIBUTING.md` inside it links all three; they are now included. The README's "Try it without installing" told a reader of the zip to run `python3 scripts/build-static-demo`, which the zip does not carry (it never carries `scripts/`); it now says the demo is built in the source repository. The entry stamp is unchanged: two builds of one commit are still byte-identical.

### Fixed: `pip install` no longer succeeds and then crashes; an old Python and a bad port say so plainly

`pip install .` used to report success, install no command, and `python -m weatherdeck run --demo` then failed with a `FileNotFoundError` for `examples/demo/scenarios.json`, because the page, the demo data and the launcher are found beside the source tree, not inside the package. Packaging them is not small, so the build now refuses at once (`pyproject.toml` names a refusing backend, `pip_not_supported.py`, which is in the release zip too) with "Weatherdeck cannot be installed with pip yet: it runs from a source checkout or the release zip", and the README says the same. Python older than 3.9 now stops at startup with one sentence (3.8 used to start and fail later in the pace code). `--port` outside 1 to 65535 prints `weatherdeck: --port must be a whole number from 1 to 65535 (got 99999).` and exits 2, instead of an `OverflowError` traceback.

### Fixed: the Windows runbooks no longer lead into silent beats

Docs only, no code and no version change. The beat's loopback push needs no token only while the host holds no push tokens; the first `token new` for any machine makes it refuse the beat with HTTP 401, and the runbooks now say so and tell the reader to run `token list` and give the beat its own token. A scheduled task must name the real interpreter, never a bare `pythonw.exe` or the Microsoft Store alias (the process looks healthy and delivers nothing); the lines that called Store Python "fine" are corrected. Also written down: never `schtasks /change` (it hangs on a password prompt over ssh; re-create with `/create /f`), the 261-character `/tr` limit and the short unpack path, where Store Python really keeps the beat file and log, and the tower preset's `display.may_sleep`, which now agrees with the tower runbook (`mac`, `laptop`; the matching is by machine id, exactly).

### Added: `scripts/release-scan`, and Python 3.9, 3.13 and 3.14 in the manual CI matrix

`scripts/release-scan` is one command for the pre-release checks: it runs `scripts/self-audit` (with `--denylist FILE` when given) and then scans the history of every ref for author and committer names and e-mail addresses that are not on an allow list given by argument (`--allow`, `--allow-file`), and for home paths and token shapes in added lines. It prints counts and kinds only, never the text of a hit, and exits non-zero on any finding. See [CONTRIBUTING.md](CONTRIBUTING.md), "Release scan". `.github/workflows/test.yml` (still manual dispatch only) now runs the suite on Python 3.9, 3.12, 3.13 and 3.14 on each of the three systems. Nothing in the product changed.

### Fixed: the host says when it refuses a push, and `token new` says what the first token breaks

A push refused with 401 (no token, or one the host does not hold) or with the "no tokens yet" 403 (a non-loopback caller) left nothing on the host: no `server.log` line and no line in the received log, so a pusher that had been accepted on loopback and was refused after the first token was made looked healthy from the host's side. Both are now logged through the same path as every other refusal (`refused POST /api/ingest from <address>: <reason>`), with the real reason (no `Authorization` header, not a bearer token, or a token this host does not hold; the token itself is never written), at most one line per client address per 10 minutes, the next line saying how many more came since. The last refusal per address is also kept in memory (256 addresses, gone at restart) in `server.last_refusals()`; nothing displays it yet, and a refused push has no source to key it by, so it is per address only.

`weatherdeck token new`, when it makes the first push token, now says that loopback pushers without a token are refused from now on, and names the loopback HTTP source ids the received log shows from the last day (or says none were seen). To make that possible the received log's lines for HTTP pushes now carry `client`, the pusher's address; older lines have none and are never counted as loopback. `client` is left out of `/api/log` on every view. No feed, pusher or beat change: the pusher stays 1.21 and the feed 1.10, and the version is not bumped here. [docs/hosting.md](docs/hosting.md) states the rule in one sentence.

### Changed: the machine beat records its push state where people look (beat 1.2)

A beat whose push was refused or could not reach the host said so once, in a log file nobody opens (under `pythonw` on Windows, in the
interpreter's private cache), and the beat file said nothing. With `--push`, the beat file now carries a top-level
`push: {state, since, code, reason}`: `state` is `ok`, `refused` (the host answered 4xx) or `down` (no answer, or a 5xx), `since` is when
the state last changed, `code` is the HTTP status or `null`, and `reason` is the host's own words or the connection error, such as
`HTTP 401 a valid bearer token is required`. It is written in the same sample as the push. A push that stays down is now said in the log
again every hour (with how long it has been down); the first line of an outage and the line on recovery are as before, and sampling is
never held longer than the 5 s request timeout. The key is the file's own, outside `machine`, so the pushed feed (apart from `producer.version` reading 1.2) and the bundled
adapter's reading of the file are unchanged, and `lookout.beat` stays at 1.0. [docs/beat.md](docs/beat.md) describes the key. Contract
tests (`tests/test_beatpush.py`) use a stub host answering 401 and an injected clock.

### Fixed: the example pusher says what it is doing and names a missing token file

`examples/adapter/push_example.py` now prints one line when it starts (which hosts it pushes to, and that it repeats every 30 s until Ctrl-C, or pushes once with `--once`), where it used to run silent. A `token-file:` credential whose file does not exist is reported as `token file not found: <path>` instead of the host being "down". `examples/adapter/sinks.example.txt` now starts with a line that works on a clean machine: `local-board` at `127.0.0.1:8787` with no credential (`-`), which a host with no tokens accepts from loopback; the file explains what to change once the host has a token.

### Fixed: the value-ledger reader knows the renamed tools

The reader had profiles only for `harbor`, `doctor` and `preflight`, so a ledger written under a new name (Lodgings already writes `"tool": "lodgings"` into `lodgings.jsonl`) read as a tool with no rule: no value events, no shares. `lodgings`, `infirmary` and `seaworthy` now read the profile of their old names (same events, verbs, shares and counter names; no counter changed), and the old names keep reading exactly as before. A tool name with no profile reads as it did. `ledger.tools` now defaults to `weatherdeck`, `infirmary`, `lodgings`, `seaworthy` (the old names still work when listed). [docs/ledger-spec.md](docs/ledger-spec.md) names the new files and says what each renamed tool writes today.

### Changed: Lookout is now Weatherdeck (breaking for every running install, no shim)

The dashboard is renamed throughout: the `weatherdeck` command (`bin/weatherdeck`, `bin\weatherdeck.cmd`), the adapter and beat commands, the `weatherdeck` Python package (`src/weatherdeck/`), the `WEATHERDECK_` environment variables, every state, config, cache and key path, the
logon and beat task names, the launchd label, the systemd unit and cron marker names, the ssh command words
(`weatherdeck-check`, `weatherdeck-ingest`), the package names (`weatherdeck-<version>.zip`, `weatherdeck-tower-<version>.zip`, the pusher zips), the value ledger file
(`weatherdeck.jsonl`, now also written by the host's own ledger writer, `weatherdeck ledger write`, with its lock file and key domain strings), the ledger cards' default tool name (`ledger.tools`), the static demo's page title and browser globals, the browser storage keys and cookie names, and the product name on the page, in the docs and in the scene. The ordinary
word "lookout" stays as scene vocabulary for the crow's-nest character (the ship-deck crow and its crow's-nest label).
Nothing answers to the old names. **Migration:** a `MIGRATION.md` listed old to new for each kind of install, each with the one command
that verifies it (it has since left this tree; the schema ids it explained are in [docs/feed-spec.md](docs/feed-spec.md), "Schema ids").

The feed, card and beat schema ids (`lookout.feed`, `lookout.card`, `lookout.beat`) and the concept fixtures' `lookout.fixture`
are **unchanged on purpose**: they are wire-protocol identifiers every deployed adapter and the live tower already speak, not
branding (docs/feed-spec.md, "Schema ids"). A future major version may add a new-name alias accepted alongside, never a replacement.

### Fixed: a placeholder source no longer reads as a failing feed

A source that declares itself a placeholder (named by another source or owning relayed work, never seen by this host, such as a
project that only ever appears through the main source) was counted in the total of the trust line ("4/5 live") and named first
among the problems ("X is not reporting") ahead of real notes. It is now left out of the total, the live count and the named
problems, on the sea's trust line, the page board and phone header and strip, and the ship plan's Crow's nest door. It is still listed
as not reporting in the Crow's nest and the Sources list, and a placeholder that does report is counted like any source. A source that
was seen and goes quiet is counted and named as before. The count rule is `trustCounts` in `web/frontdoor.js`, with contract tests on
synthetic sources.

### Changed: the open sea is the front door again; the page board is a door away

Since 0.7.0 the page board was `#/sea` on every size, so a TV, which cannot scroll, showed only the call lists and never the fleet.
Now, on any window 700 CSS px or wider, `#/sea` (and no route) is the full-screen stage again, as in 0.6.0: the fleet on the water,
one ship per machine with its name plate, sky and weather by time of day, the headline card for the calls on the left and the log
with the allowance along the bottom. The ship opens its plan, a place its list, and the plan's OPEN SEA comes back out, with the
camera moves of 0.6.0 (theme spec section 24.4).
- The page board, unchanged, is now `#/board`. It is opened from a **Lists** door beside the `?` on the sea (the theme's new zone
  `lists`) and from the same door in a ship's plan bar; its header has an **Open sea** door ("Back to the open sea"), and Esc and
  Back go up to the sea. An idle TV left on it sails home after `display.idle_return_s`, as from a place.
- The television profile (the `tv` view, any household-level profile, or privacy mode) never shows the page board: the sea is the
  whole display there and `#/board` draws the sea.
- The headline card opens the Bridge on every profile, as in 0.6.0.
- The default theme's `place_sea` is now "Open sea" (was "Board"), so the ship plan's way out reads OPEN SEA in every theme.
- On a phone `#/sea` is still the page board, as before.
- Each ship plate on the sea carries a quiet badge: the calls waiting on you from that machine and its lanes off course plus its
  critical alerts, each a glyph and a number (a call naming no machine counts on its source's machine; one naming neither stays on
  the card only), so nothing that needs you hides when the board is no longer the front door.
- The sea's ambient loop now parks off screen only where its picture can scroll away (the page board's picture slot, the phone's
  banner), so the TV stage's sea never stands still while it is shown.
- The ship-deck and default themes' since plate (and ship-deck's open-sea banner) end before the new Lists door. New labels:
  `place_board`, `open_board`, `back_to_sea`, `ship_calls`, `ship_trouble`. The route and badge rules live in `web/frontdoor.js`, with contract
  tests on synthetic data (`tests/test_frontdoor.py`). Checked headless at 1920 x 1080 and 390 px; the device check on the TV is
  open (docs/device-checklist.md).

### Added
- The library (feed 1.10, `mirrors[]`; feed spec, "Library"): a source that mirrors folders of notes into a shared repository says, per
  folder, when its sync job last ran, how that run ended, origin's newest change to the folder and what is not in the repository yet,
  copied from the receipt the job writes on every run. The host gives each folder one word from a closed set, each with one rule
  (`src/weatherdeck/gaps.py` `mirrors`): UP TO DATE (a live source, a receipt within its limit, a run that pushed or found nothing new,
  nothing pending), WAITING n, FAILING, NOT CHECKED (the job's last run is older than its limit; "the board cannot tell why"), SILENT
  (the source is silent; the last word is kept as last known and the ages stop), UNKNOWN (a receipt the rules cannot read, never 0),
  NOT REPORTING (a folder the new host config `mirrors.expected` lists and no source reports) and RETIRED (only from `mirrors.retired`
  or the row's own `retired`, never from age). It raises no card. The board draws it as a LIBRARY chip row on the TV log and in the
  page board's quiet rows, worst first, and as a LIBRARY section on the phone and in the Crow's nest. The household view keeps the
  folder, the word and the ages and drops the job's words and the retirement note; the public view has no library. Contract tests on
  synthetic data for the derivation and the 1.10 field.
- Bundled adapter 1.21 (adapter README, "Library"): `mirrors: [{"receipt": path}]` reads the knowledge sync's receipt
  (`fm.knowledge-receipt` version 1, written atomically to the home's `state/knowledge-sync.json`; the README is its contract for the
  sync script) and sends one `mirrors[]` row per folder, plus a `mirrors` collector that is an error for a receipt that is missing,
  unreadable, of another format or partial, and stale for one older than three of its job's intervals, so the trust line names it
  even on a host that does not draw the row. `check` prints each receipt. A `MEANING` entry says what an older adapter cannot.

### Fixed
- `scripts/build-package` stamped every zip entry with the newest file mtime of the working tree, so a fresh clone of the same commit gave
  different zip checksums with identical contents and checksums could not be compared between machines. Entries now carry one fixed time:
  `SOURCE_DATE_EPOCH` when set, else the commit time of HEAD, else 1980-01-01 outside a git checkout; the build prints it. Two builds of
  one commit with the same Python and zlib on the same OS, in different clones, are byte-identical (checked with `sha256sum` on two fresh
  clones); across machines or OSes, compare per-file content as the README shows (file modes still differ on a Windows checkout). Nothing packaged, no name and no version changed.
- Every redacted view (household, guest, public) now drops a collector's error text from `sources[].freshness[]` too, as it already
  did from `sources[].collectors[]`.

## [0.8.0] - 2026-10-12

Per-machine livery and weather transitions on the ship deck, a browser-only static demo, and the host's own value ledger. Feed version unchanged.

### Changed
- Bundled adapter 1.20 (adapter README, "Quota"): with `quota_providers` set to `"auto"`, a provider's quota card is critical only when a
  configured worker names the provider (the harness and model strings in the home's `config/crew-dispatch.json` and `config/crew-harness`,
  read only, bounded, read again only on change). Otherwise the card is informational and says "not used by any configured worker"; with
  those files absent every card is informational. An explicit list is unchanged. No new feed field. A `MEANING` entry names the older behaviour.
  Contract tests on synthetic data.

### Fixed
- The auto-tour is never active on the television profile (the `tv` view, any household-level or privacy profile): it is refused there
  whatever `display.tour` or `#tour` say, and the browser console says so. Off by default elsewhere, as before.

### Added
- A static demo: `scripts/build-static-demo` writes a folder of plain files (the page plus a recorded feed) that opens from a file or any
  static host with no server. A "DEMO: recorded synthetic feed" bar is markup in the page, so no feed can remove it; the recorded frames
  of the synthetic demo (`examples/static-demo/recorded-feed.json`, made by `scripts/record-demo-feed`) replay in order, unchanged, on a slow
  timer (held, with a button, under reduced motion); a missing recording is said, never faked. The live page is unchanged. The build runs
  the self-audit on its output, and a contract test checks the label and the recording.
- The host writes its own value ledger (off by default: `ledger.write`, or `lookout ledger write [--dry-run]` on demand; docs/ADDINS.md,
  "Writing the ledger"). From rows it already keeps in `history.sqlite` it appends one line per counter and closed UTC day to
  `lookout.jsonl`, where the existing Lookout ledger card reads it: pushes accepted and rejected (and per source, under an opaque key, never
  the id), feeds missed, calls raised, lanes a source reported failed, restarts, work that landed, and silence episodes rebuilt from the
  pushes, each with its table, filter, first and last row, the rows left out (sample) and a digest of exactly the rows counted. The
  conditions the board derives itself (`surfaced_cleared`, the value event), views and missed events stay unknown, each naming the one field
  that would make it measurable (a new optional `needs` string on an unknown line, additive in version 1), and a day with no push at all is
  unknown, never a quiet zero. The file is only appended to, in one atomic step, and a ledger the reader cannot read (torn, not UTF-8, a
  symlink, another tool's, too large) is left as it is and reported. No process or thread is added: one comparison after each accepted
  push, after the ingest lock is released, and at most 2 days per push (a day counts as closed 300 s after it ends); 0.21 CPU s once a
  day for ten sources at 30 s (measured, ADDINS.md). Source keys and the default host label are keyed with a per-install random salt
  (`<data dir>/ledger.salt`, mode 600, never written out), so they are not comparable across installs; the host label of the first write
  is kept in `<data dir>/ledger-writer.json`, and a day the ledger already holds is never written again under any label. No package version change. Contract tests on synthetic history.
- Community files: `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`, bug report, feature request and "the board showed something wrong" issue templates, and a pull request template. The maintainer contacts are placeholders to be set before publication.
- Weather transitions on the ship deck scene (theme spec, section 26): when a machine's real state changes between two feeds, its cloud
  and rain grow or fade in four steps over 600 ms, then rest. Runs only on a real change of the machine's word from
  `machines[].strain.state` and `status`, never at first load or on a timer; reduced motion changes at once; a stale or silent source
  keeps its frozen last-known weather with no animation. No new feed field. The change rule has contract tests on synthetic feeds.
  New and unchecked on real devices.
- Per-machine livery on the ship deck scene (theme spec, section 25): a hull stripe and a swallowtail masthead pennant in one of six
  fixed muted tones, picked by the FNV-1a hash of `machines[].id` modulo six, so a ship has a face at a distance and keeps its
  colour. Identity only, never a state; no id draws no livery. Escorts carry a larger pennant and no stripe. Cached in the hull
  layer (no per-frame cost); no new feed field. The board key gains "Pennant colours: which machine, nothing more...". The hash rule
  has contract tests on synthetic ids. New and unchecked on real devices.

## [0.7.1] - 2026-10-12

A call that was already answered, or that comes from an old copy, no longer reads as current without saying so. No new read or refresh.

### Added
- Feed 1.8, the call as-of (feed spec, "Call as-of"): an optional `attention[].as_of`, the time of the copy of the answer behind the call.
  The page draws a call whose copy is older than its source's limit as **last known, N old; not confirmed**, and the waiting-on-you count
  reads **at least N** while any call is drawn so. A call with no `as_of`, or a source with no limit, gets no marker. Demo:
  `--scenario call-last-known` and `--scenario call-fresh`.
- Bundled adapter 1.18 (adapter README, "Call as-of"): each call carries the time of the source copy it came from, and the push
  fingerprint ignores it. A `MEANING` entry for 1.18.
- Contract tests `tests/test_stalecalls.py` under the owner's extended exception (CONTRIBUTING.md): two sources that share a hold id where
  the owner dropped it (no card), an old copy (past the limit) and a fresh one; the 1.8 field; the push fingerprint.

- Feed 1.9, the call options (feed spec, "Call options"): an optional `attention[].options`, at most 4 plain words of at most 60 characters,
  drawn as read-only chips under the call on the page (not buttons; the answer path stays in the review board). Dropped from the `tv`,
  guest and public views. Demo: `--scenario call-options`.
- Bundled adapter 1.19 (adapter README, "Call options"): fills `options` only from the source board's options for that call or a summary
  decision record that carries them, never from free text. A `MEANING` entry for 1.19.
- Contract tests `tests/test_calloptions.py` under the extended exception: with options, without, too many or too long, and the tv view.

### Fixed
- The host's merge of a call two homes both list (`hold:<owner>/<task>`): when the owner reports and its own feed no longer lists the call,
  the relaying home's copy is dropped instead of winning the card.

## [0.7.0] - 2026-10-12

A tool that runs on someone's machine keeps a budget, gives way when the machine needs the room, and says so: the feed
gains `pace` (1.4), and the board says a slowed source is **slowed on purpose**, never silent and never as fresh as
before. Feeds of any 1.x version are read as before.

Each lane can say, in one of nine fixed words and one sentence of template parts, what it is doing, what it waits on, since
when and what it said last (feed 1.5, `items[].lane` and `items[].say`), from records the home already keeps and never from
a worker's words. The board now says them (below). The bundled adapter is 1.16.

A call that waits on the captain can carry one link to the review board, where answering and messaging the agent already work
(feed 1.6, `attention[].answer_link`; the bundled adapter learns the address only from the review tool's own session listing, and
says why there is no link when it cannot). The link opens the review board where the call is waiting, not the call's own card: the
board has no per-card anchors yet, and a per-card deep link needs a change in the board template, which is outside this repository.
Every call on the board gets the same board address. The board stays read-only.

The board's normal screen is a page that says what needs to occur and what each lane reports, in plain words, on a television, a
laptop and a phone (approved as a mock-up by the captain). It needs its own device check by a person: the captain's earlier
device sign-off covered the depth scene only ([docs/device-checklist.md](docs/device-checklist.md)).

Each lane can sit under the goal it serves, with a count of how many rows each goal has and which of those counts may be low
(feed 1.7, `goal` on items, `next[]` and `done[]`, and `goals[]`), from a plain text goals file the captain keeps in the home, never
from a worker's words. The feed and the view carry it, and the page board groups lanes under their goal, each with its counts;
lanes no goal names stay grouped by project. A home with no goals file reads as "no goals set" and the board is as it was.
The bundled adapter is 1.17.

The bundled adapter's layout contract: a replay of recorded state through the adapter, and reads that no longer turn a
changed layout into zeros. No feed change and no change to the board or the scene from it (the lane fields above are separate).

### Added
- Feed 1.6, the answer link (feed spec, "Answer link"): an optional `attention[].answer_link` `{url, label, state, state_as_of, why}` on a
  call that waits on the viewer: where it can be answered on the source's review board, when the source last checked, or in words why there
  is no link. The schema reads it (`src/lookout/schema.py`); a television (household), guest or public view drops it
  (`src/lookout/view.py`), because the address names a machine. The page draws it as one plain link on the call, "Open the review
  board", opened in a new tab (it opens the board where the call is waiting, not the call's own card: the board has no per-card anchors
  yet, and a per-card deep link needs a change in the board template, outside this repository), with "board link checked N min ago" (no script, no write, the board stays read-only); with no link it says
  the source's reason and the same age ("no review board is open for this home"). Demo: the first call carries a link, and
  `--scenario board-link-none` shows the reason.
- Bundled adapter 1.16, the review board link (adapter README, "Review board link"): the address is learned only from the review tool's
  own documented session listing (the tool's own command with no arguments, one short call under a timeout in the background, at most once per
  `board_link_every_s`, never inside a push, never opened from the tool's private state). The link is sent only when the session listed for
  this home's board file is `open`, the answer is young (`board_link_old_s`), the address can be opened from another device, and the
  call's key is on that board file. No session, an ended session, a missing or failing tool, a session for another file, an answer too old or
  a listing it cannot read give no link and a fixed reason, never a stale address. New settings `board_link_cmd` (`null` turns it off),
  `board_link_every_s`, `board_link_timeout_s`, `board_link_old_s`; the check age does not by itself make a push. A `MEANING` entry for 1.16.
  Replay: `fixtures/main-truth/` holds a fake session listing, `board_link_age_s` and `board_link_failed` in `fixture.json` replay an age and a failed ask.
- Contract tests `tests/test_boardlink.py` under the owner's extended exception (CONTRIBUTING.md): a synthetic fake listing for an open board,
  an ended one, a missing command, a command that fails, a session for another file and an answer too old; the 1.6 field; what the
  television, guest and public views drop of it.
- The page board ([docs/theme-spec.md](docs/theme-spec.md) section 24, `web/page.js`): a header with the clock, how many feeds
  report and a **Key** button on every size; a three-state strip (**Needs you**: each call as its title, reason, recommendation,
  where to answer and the line to say; **Needs attention**: criticals, lanes that need it, lanes that can't be read (one line per
  machine), a silent or missing feed, an unverified number and bad add-in cards; **All fine**, lit only when both are empty and every
  feed reports); lane rows with a state icon and word, the job in plain words (`lane.short_title`, or "short name only"), project and
  machine, the one sentence worded from `items[].say`, and the worker's own notes behind a tap; lanes grouped by project (a group
  holding something that needs someone first), with counts (lanes with no lane word and lanes with a word this board does not know counted apart) and the fold "+N waiting on a check"; a caption for every place below
  decks and for every picture the sea draws (ship, sailor, crow, lighthouse, islands ahead, lit windows), also in the key, which now
  lists the nine words with what each means. A lane whose feed sends no lane word keeps its older words and says so; an unknown word is shown as
  sent; nothing is read from prose, no link to a review board is drawn unless a feed sends `answer_link` (below), no option list is made from a reason, and nothing is added per refresh.
  Both themes; the sea panel is the ship deck theme's scene window. The place captions now read "calls waiting on you", "every lane, grouped
  by project", "what is queued next, and what it waits for", "what landed", "machines, who reports, allowance" and "what this screen
  showed, and the key". Demo: the lane words in the three demo feeds, and `--scenario lane-state` (all nine words and a fold).
- Feed 1.7, goals (feed spec, "Goals"): an optional `goal` (the goal's name, plain text) on `items[]`, `next[]` and `done[]`, and an
  optional top-level `goals[]`, one header per goal that has rows, `{name, lanes, next, done, or_more[]}`. The counts are the rows the
  feed carries; `or_more` names each count that may be low because rows were left out (a feed limit, the source's or the summary's own
  bound on landed rows, landed rows with no date), so a landed count reads "N done, or more", never a total. A row no goal names has
  no `goal`, and a board groups it under its project. The schema reads all of it (`src/lookout/schema.py`, `goals` limit 20). The host
  (`src/lookout/goals.py`) carries `goal` on rows and builds the view's `goals[]` from the merged rows the view carries: one header
  for a goal two sources spell alike, a second-hand copy counted once, no header for a goal no carried row carries, `or_more` kept
  from any source and "or more" on `done` when the merged landed rows were cut at 30; a guest or public view drops every
  goal name, as it drops titles.
- The page board groups lanes by goal ([docs/theme-spec.md](docs/theme-spec.md) section 24.2, `web/page.js`): each goal in the view's `goals[]` is a
  header with its name and a count line ("N lanes", the lanes' words, "N next", "N done", each "or more" where the feed says the count may be
  low) and its lanes beneath it; a goal with nothing in flight is one line of counts; lanes no goal names stay grouped by project, each
  such group tagged "no goal set: shown by project" while goals exist. With no goals set the board is exactly as before and says so once. Goals that hold
  something that needs someone come first, then the others in the order the feeds name them, then the projects. The Gun deck's caption reads
  "every lane, grouped by goal, else by project". Demo: `--scenario goals`. Both themes; no new colour, creature or number. The new grouping needs
  its own device check by a person.
- Bundled adapter 1.17, the goals file (adapter README, "Goals"): `config/board-goals` in each home (`goals_file`), a plain text
  file the captain edits, one block per goal with member lanes by `project:`, `title:` (whole words) or `id:` (a trailing `*`
  matches the start of an id); the first block that matches wins. Read again only when its time or size changes (one `stat` a pass,
  the reading kept in the state file); a file that is missing, unreadable, over 64 KB or empty is "no goals set", never an error;
  nothing is guessed from a lane's prose and no model is called. Lanes, queued rows and landed rows get their goal; the feed carries
  `goals[]`. A `MEANING` entry for 1.17 (it sends no goal), so the host can flag a machine on an older adapter once another runs
  1.17. A synthetic example file ships with the `main-truth` fixture.
- Contract tests `tests/test_goals.py` under the owner's extended exception (CONTRIBUTING.md): the goals file's reading (blocks, the
  three matchers, first match wins, the limits, a missing or unreadable file is no goals, read on change only), the headers and
  their "or more", the 1.7 fields, the view's merged headers and what a guest view drops. Synthetic data only.
- Device checks: the dashboard depth scene (ship deck scene with the islands ahead, lit stern windows and the squall for a
  machine that is not answering) was signed off on Safari, iPhone and a 4K television on 2026-10-10 by the captain:
  "I approve of the dashboard. The device checks sign off." The squall has no checklist item and rests on the captain's word
  alone. The sign-off covers nothing else: not other pages or themes, not
  other tools' device checks, and not any later change to the scene ([docs/device-checklist.md](docs/device-checklist.md)).
  README support matrix updated to say so. No code change.
- Feed 1.5, lane state (feed spec, "Lane state"): an optional `items[].lane` `{state, cause, since, last_word{verb, at},
  short_title}` and `items[].say`, an ordered list of template parts `{t, ...slots}` the board words itself. `state` is one of
  nine words (Working, Waiting on a check, Waiting on another lane, Waiting on the supervisor, Waiting on you, Needs attention,
  Paused on purpose, Finished, Can't tell); `cause` a fixed id of the rule that chose it; `since` the time of the record that
  said it (else the first pass that saw it); `last_word` the newest status verb and its time; `short_title` the job's title
  cut at a clause break before any word, null when the only title is the task name. A sentence carries times and numbers, never an
  age and never a worker's sentence. The schema reads both (`src/lookout/schema.py`); the view keeps the source's `lane` as
  `source_lane` beside the host's own class, and a guest or public view drops `short_title` and the `title` slot. No change
  to the board or the scene.
- Bundled adapter 1.15, the lane state mapping (adapter README, "Lane state"): the crew state its supervisor reads (the fixed
  state, source and detail words) plus the declared-wait record, the lane's agent record, the summary's open questions and
  unresolved blockers and the source's captain holds, first match wins. Rules: a run that failed after which the worker
  declared a pause is Paused on purpose, not Needs attention; a lane that cannot be read is Can't tell with its last word,
  never its last word as its state; a stop at a gate is the supervisor's only when the crew state says the answer is
  owed by a human (the one word it mints for that); a lane with a check running is not called stalled for a quiet ledger;
  a failed lane with no status record, and a second-hand failed copy, get no `lane` rather than a wrong one; the crew
  state's detail words are read only from the run step or the pane, never when the source is the status log or not recorded
  (a mate's second-hand lane, an own lane the summary does not list). The mapping
  uses none of the retired claim words and `WAIT_RULES` decides nothing.
- A `MEANING` entry for 1.15 (it sends no lane state), so the host can flag a machine on an older adapter once another runs 1.15.
- Contract tests `tests/test_lanestate.py` under the owner's extended exception (CONTRIBUTING.md): one synthetic fixture per
  state, the combination rule, unknown stays unknown, a note from an unknown or status-log source read as nothing, the title cut, the 1.5 fields and what a guest view drops.
- Ledger cards, slice 3 of the tool value ledger ([docs/ADDINS.md](docs/ADDINS.md), "Ledger cards"): one small status card
  per tool on the board, built with the existing card mechanism from the tool's ledger through `src/weatherdeck/ledger.py`.
  Each says the reading (keep, quiet, cut candidate, unmeasured) with its 14-day window, and per counter the value or why it
  is unknown, in the record's own verbs; a counter that is not covered reads "at least" or unknown, and a missing or unreadable
  ledger reads "No ledger yet", never zero. **Off unless asked**: `ledger.enabled` (default `false`), `ledger.dir`,
  `ledger.tools`, `ledger.expected_hosts`, `ledger.max_kb` ([docs/hosting.md](docs/hosting.md)). No new process; per refresh
  one `lstat` per listed tool, and a file is read again only when it changes or the day ends. `docs/honesty.md` says what the
  cards claim and do not.
- Ledger cards label a counter only with a name from the spec's "Counters" table (any other reads "other counter, not in
  vocabulary"), and the reader skips a line that gives a number to a counter whose name uses a retired word
  (`retired-word-in-counter`), which makes the card "Ledger not valid". The v1 placeholders `caught` and `minutes_saved`
  (`value: null`) are still accepted, counted on the card as "not measured" without their names, and deprecated in the
  spec, to be dropped in the next version. Coverage on a card is
  rounded down exactly, and while ledger cards are on a drop-directory card with a `ledger-*` tool id is rejected.
- Contract tests `tests/test_ledgercards.py` under the owner's extended exception (CONTRIBUTING.md).
- The tool value ledger, slice 1 ([docs/ledger-spec.md](docs/ledger-spec.md)): the append-only file per tool (one line per
  counter per window per host; an unknown is `value: null` with its reason, never 0; every number carries its record range
  and the digest of the rows it was counted from), the five reasons a counter can be unknown, the honest verbs, and the
  reading rule with its thresholds as documented defaults (14 days, coverage 0.9 and 0.5, two quiet windows, 30 % judged
  wrong, 50 % overridden). Nothing writes a ledger yet; the board reads one only when asked (see the ledger cards below).
- `src/weatherdeck/ledger.py`: a small pure reader. `read(path, to)` opens the one file it is given and returns, per counter,
  the value or unknown with its reason, coverage and quality, and the tool's reading (KEEP, QUIET, CUT-CANDIDATE or
  UNMEASURED) with why, and whether a number may be cited outside. A bad or missing file is unknown, not an error.
- Contract tests `tests/test_ledger.py` under the owner's extended exception (CONTRIBUTING.md).
- Feed 1.4, `pace` (feed spec, "Pace"): the factor every interval is stretched by, why (`load`, `battery`, `cpu_budget`,
  `run_budget`), since when, the intervals now and at normal pace, the load per core and battery state seen, and the cost
  against the source's own budgets (CPU seconds an hour, wall seconds of the last pass; null where not measured, never 0).
  The view's `sources[].pace` (`src/weatherdeck/gaps.py` `pace`) reads it as the source said it; the host works out none of it.
- The board says it (theme spec 19.6): the trust line ("atlas-main: slowed on purpose (the machine is busy), reports about
  every 3 min", before the old answers it explains), the Crow's nest reporter row, and its detail (PACE, COST). No lamp,
  creature or colour changes; a source that sends no `pace` gets no words.
- Bundled adapter 1.13, budgets and a back-off: a wall-time budget per pass (`run_budget_s`, 10 s) and a CPU-seconds-an-hour
  budget for its passes and background refreshers together (`cpu_budget_s_per_h`, 90 s), measured in a small
  ledger beside the state file. A busy machine (1-minute load per core from `pace_load_per_core`, 1.5), battery power
  (x2), a spent CPU budget or a pass past its budget stretch every interval the adapter keeps (a pass, the keepalive,
  how often the source board, the daemon probe, quota, the PR states and the deploys are asked) by a factor of up to 4, and it comes back by
  itself when the cause clears (the load with a 20% margin, the CPU budget when the hour is under 70% of it). A pace the
  board has not been told is pushed at once. `check` prints the pace and the cost it measured and each background
  collector's wall and CPU seconds; `log` marks a slowed push; the refreshers record their own CPU.
- `fixtures/mac-busy` (a Mac at load 3.1 per core: a pace of 3x), and `"pace"` in `fixture.json` to replay a machine's
  load, battery and cost.
- `examples/adapter/push_example.py --back-off LOAD_PER_CORE`: the same contract in the generic example.
- Measured cost in each tool's docs: the adapter ("Pace and cost"), the beat, and the host, with the machine and the method.
- Contract tests `tests/test_pace.py` under the owner's extended exception (CONTRIBUTING.md).
- The bundled adapter's `weatherdeck-*-replay` script, in its own directory under `adapters/` (`run`, `record`,
  `check-home`): replays recorded state of the home it reads through the real adapter (`--fixture`, in an isolated HOME and config, so it never reads a live home) and checks that
  every file the adapter cannot read comes out as an `error` or `stale` collector with a reason and no rows, never as
  `ok` with nothing in it, that a collector which is not ok carries no numbers, and that the feed is a valid
  `lookout.feed`. `record` writes a redacted snapshot of a live home (stable pseudonyms for ids, placeholders for text,
  paths, hosts and links, times moved to a fixed clock; it refuses to write a file that still holds an original string).
  `check-home` records a home to a temporary directory, replays it and keeps nothing: the run after the tool
  behind the home is updated. Besides the ledger and the home summary it records and probes the busy-state records of
  the lanes it keeps and, given `--slot-dir`, a slot runner's directory: a busy-state record it cannot read never reads
  as `ended`, a slot directory it cannot read makes the queues collector `error`. A ledger line or slot entry of a
  layout it does not know is kept (the last twenty), so a renamed layout survives into the copy; a key that is not a
  known layout key is pseudonymised and never exempt from the leak check.
  Snapshots: `fixtures/snapshots/home-main` (recorded from a real home), `home-mate-a` and `home-mate-b` (the two other
  homes readable on the recording machine; the captain's main home is still owed), `home-main-stale` (its summary two
  hours old) and seven broken layouts, `layout-summary-renamed`, `layout-ledger-renamed`, `layout-ledger-mixed`,
  `layout-ledger-events-renamed`, `layout-ledger-v2`, `layout-busy-renamed` and `layout-slots-renamed`. `record --force`
  replaces only a directory that is already a snapshot, and only the files a snapshot owns. Run its `run`; see the adapter README, "Layout replay".
- The bundled adapter's `hooks/pre-push`, an opt-in hook that runs the replay when a push touches the adapter's
  directory (one install line in the adapter README and CONTRIBUTING.md).

### Changed
- Adapter 1.14: a home summary of the right schema that lacks one of its row lists (`active_children`, `decisions_open`,
  `queued`, `landed`) is a layout the reader does not know: the queue and attention collectors say `home summary layout
  changed (no ...)` (the last good copy is kept when there is one) instead of reading the missing rows as none. A ledger
  with lines of which none reads, and none ever did, makes the items collector `error` ("no ledger record could be read
  ... its format may have changed") instead of `ok` with no lanes. A ledger that read and whose last three lines or more
  since do not read, or are of a `v` other than 1 or an event it does not name (new-format lines appended after old
  ones), makes the items collector `stale` as of its last good record ("the last N ledger lines cannot be read or are of
  an unknown version or event; its format may have changed"), and `error` when no line ever read, across restarts too, instead of showing the
  lanes from before the change as current. A slot directory with a holder that has no pid, a waiting ticket that does
  not parse, or no holder or waiting room of any configured class makes the queues collector `error` with no queue
  rows instead of `ok` with empty queues. Replayed before and after over every existing fixture: the same feeds, apart
  from these cases.
- Wording: "caught" and "saved" (and "prevented", "avoided", "averted") are retired as claims on every surface until a
  number behind them is measured; the honest verbs are surfaced, refused, placed, landed and not dispatched (upper bound).
  The honesty document says that no value number is shown until it is measured. No claim in this project used the words,
  so nothing on the board changes.
- The adapter's loop (`push --every`) stretches its period by the factor as well as by twice its own pass time.
- The adapter's loop stops within five seconds of SIGTERM or SIGINT, and its signal handler only sets a flag: one of ten
  loops under test did not exit on SIGTERM (a lock inside `Event.set()` called from the handler is the suspect; it did not
  recur in twelve more tries after the change, and the cause was not proven).

### Fixed
- Bundled adapter 1.12: a lane whose state the source board (or the home summary) says it cannot read now stays `unknown`. It used to
  take its newest ledger status word as its state, so lanes whose state could not be read showed as PAUSED. The newest word
  and its age are now said in the row text instead ("state can't be read now; last word: paused, 3 h ago").
- Bundled adapter 1.12: `waiting_on` is set only from what the home records: `human` for a `needs-decision` lane or one with
  an open captain decision, `gate` for a parked lane or one with unresolved blockers. It is no longer guessed from keywords
  in the worker's sentence, which made a lane waiting on its own tests read ON CAPACITY ("slot") and a lane the captain
  parked read ON A PERSON. A held lane none of those speaks for is plain paused. `until` is still read from a date or time
  the line names. The feed spec is unchanged (1.3); the adapter lists both changes in `producer.meaning[]` since 1.12, so the
  host flags a machine on an older adapter once another machine runs this one.
- Replay fixtures: none encoded the old guesses, so none changed; their feeds replay as before.

### Checked on
- The adapter, 1.13, one-shot every 20 s (a driver doing what launchd does) and as a loop, against a synthetic home and a
  local host, on one Linux machine under WSL2 (24 threads, shared with other jobs, 1-minute load 3 to 25 with spikes to
  190; **not a Mac**): battery on for five minutes then off (2x at the first pass, 1x at the first tick after), the machine's
  own load (2x for one round at a spike, 4x in the 100 to 190 storm, back by itself), a CPU budget of 5 s an hour (spent at
  ten minutes, 4x held, released when the budget was raised), a 1.6 s sink against a 1 s pass budget (2x, a pass every
  40 s), and the same driver with no back-off through the storm (passes of 69, 21 and 172 s). Measured cost, with the
  method, is in the adapter README ("Pace and cost"): about 25 CPU s an hour one-shot on a quiet machine and 6.6 as a loop;
  slowing 4x took a one-shot hour with a heavy collector from 66 to 26 CPU s and a loop's from 6.6 to 1.9, but a one-shot
  hour with a cheap collector only from 24.7 to 21.0, because the interpreter's start-up (0.10 to 0.11 s a launch) is the
  cost and a tick that is not due still pays it. The first default CPU budget (60) tripped under normal load and was
  raised to 90. A deterministic walk through the pace rules with a fake clock (4 hours) went through load, battery and
  CPU in order and released each.
- The page, headless Chrome 150 at 1920 x 1080 and 390 x 844, with one source slowed 3x (`fixtures/mac-busy`) beside one
  that sends no `pace`: the trust line, the Crow's nest row and its PACE and COST lines; at the same age (158 s) the slowed
  source's lamp was live and a normal one's late, and a slowed source that stopped read "silent 16 min" like any other.
  No page errors.
- The host and the beat measured (docs/hosting.md, docs/beat.md): 1.1 ms of CPU a push, 0.3 ms a read, 0.6 CPU s an hour
  idle; the beat 0.4 to 1.4 CPU s an hour against its 18 s budget.
- 102 tests pass (`python3 -m unittest discover -s tests`), and `scripts/self-audit` is clean.
- Not checked: a real Mac (launchd, the installer, `pmset`), a real source-board run, systemd, Safari, an iPhone, a TV. Those
  are in the device checklist ("Slowed on purpose").

## [0.6.0] - 2026-10-10

Machine alerts are debounced, the honesty contract is one page, the far horizon tells the queue and the stern windows tell
the agents. In this release the feed is 1.3 and the bundled adapter 1.11; feeds of any 1.x version get all of it.

This release also carries the 0.5.0 changes below (per-machine versions, the package hash on the health endpoint, feed
1.3), which were never packaged on their own, so a host on 0.4.1 gets all of it.

### Added
- Machine alerts are debounced (honesty rule 8): an `attention[]` card of kind `machine` or `disk` that is not critical
  needs two feeds in a row from its source to be raised and two in a row without it to be cleared. It can therefore
  appear, and go, up to one keepalive (the source's `interval_s`) later than the source's own state, and the honesty
  document says so. A critical, a `service` card (supervision down, a daemon down) and the host's own lost-machine card
  are never debounced. An alert said once is not dropped and not counted: `attention_pending[]` and
  `counts.attention_pending` in `/api/view` (one per id, never a copy of a confirmed id, held against its source's
  machine when it names none), with a row in its bridge, until a second feed confirms it or leaves it out. Unless the
  card is `info`, the page also reads that machine as ALERT UNCONFIRMED (it never moors and never reads OK); a pending
  `info` card leaves the word and berth as a confirmed one would, so the debounce never makes a machine flap. The state is one row
  per source and alert in the host's history file (`machine_alerts`); `src/lookout/debounce.py` is pure.
- `docs/honesty.md`, the honesty contract as one standalone page: the rules, the feed field behind every number,
  creature and light, which numbers are measured, derived or unknown, what the board can and cannot know and what it never
  claims, and the debounce with its one-keepalive latency. Linked from the README.
- An AI-drawn art disclosure in `web/themes/ship-deck/CREDITS.md`, limited to what the repository's records show.
- The far horizon tells the queue (theme spec section 23.1): one island for each `next[]` entry, none when `next[]` is
  empty or missing (the horizon stays empty and the receipt says "No islands ahead: nothing next in the feed"). At most
  three on the TV, one on the phone, the true count kept in the bar and the receipt. Size and distance come from the
  entry's own date (today or earlier, tomorrow, later: three steps, nearer and larger as the day comes) or, with no date,
  its place in the queue; a held entry sits in mist, a gate carries a beacon post. An island is a dotted outline when its
  source's queue report is old or failed, and under fog when its source is silent. They stand in the widest stretch of
  horizon no rig covers, with a moonlit rim at night, in the cached sky layer (no per-frame cost, nothing moves). This
  replaces the single island drawn whenever anything was queued, however many items.
- Stern windows (section 23.2): one for each lane that has work an agent should be at, from `items[].agent.state` alone:
  lit for `alive`, dark glass for `ended` or `gone`, a shuttered window for no agent record, an unknown word or an old
  report; none for finished work, nor for failed lanes, which are flagged as needing action separately. In the stern
  castle of a full-scale ship and on the hull of a half-scale escort (up to four, the lanes that need a look first), on
  the phone banner and the convoy strip's mini ships. The scene receipt counts every lane.
  This replaces the row of portholes that were lit at night whatever the fleet did (and sat under the hull plate).
- The key's "On the sea" line and the Logbook's legend say what each drives, in words.
- The demo scenarios `horizon` and `horizon-open` (the same on the open sea): five items next from Atlas (six with
  Borealis's), mixed agent states, the ahead list's report going stale after 45 s and Atlas going silent after 90 s.
- No per-frame work: `#ambient=stats` on the open sea averaged 1.08 ms a frame with the scenario against 0.97 ms without it
  (headless Chrome on a busy shared machine, so only the difference is meaningful).
- No new feed field, config or adapter change: both read fields the bundled adapter already sends.

### Changed
- The README's support matrix no longer says Safari and iPhone are supported: only headless WebKit has been run, and the
  real-device checks in `docs/device-checklist.md` are still owed to a person.

### Checked on
- Headless Chrome (the project's chrome-devtools-axi) at 1920 x 1080 and 3840 x 2160 (the TV profile, with a call waiting
  and on the open sea, by day and by night), 390 x 844 at 3x (phone), on the synthetic `horizon` and `horizon-open`
  scenarios: islands in the three steps, mist, beacon, dotted and fogged, the windows in all three states on the flagship
  and the escorts, no console errors, no page wider than its window. Not run on a real TV, Mac Safari or iPhone: see
  `docs/device-checklist.md`, which gains the checks only a person can make (are the islands and windows readable from the
  viewing distance).

### Fixed
- A machine whose plate says NOT ANSWERING (`machines[].status: down`) no longer sails under a clear sky, calmer than a
  struggling one under rain: it gets a squall, the storm cloud and rain over its ship with no lightning, no red edge and
  no change to the sky (those stay the critical's). Silent, lost and no word stay fog; asleep, draining, maintenance and
  reserved stay clear because they are declared, and the plate says so (theme spec section 21.1). The scene receipt says
  "a squall".

## [0.5.0] - 2026-10-10

Which software each machine reports from, and a version gap only when it changes what the machine can say. Feed 1.3
(optional fields only: a 1.0 to 1.2 feed reads exactly as before). The bundled adapter is 1.11.

### Added
- Feed 1.3 `producer.host`, `producer.pusher` `{name, version}` and `producer.meaning[]` `{since, effect}`
  (`docs/feed-spec.md`, "Versions per machine"). `producer.version`, already sent since 1.0, is now carried through the
  merged view: `sources[].producer` and `sources[].skew[]` in `/api/view`, `counts.version_skew` and
  `counts.version_unknown`, and `adapter` on each line of the received log.
- `src/lookout/skew.py` (pure): a source is flagged only when its version is older than a `meaning[]` entry's `since` and
  another source with the same producer name already runs a version that has it; the reason is the entry's `effect`. A
  source that reported no version, or one that is not a plain dotted number, is "version unknown": never guessed, never
  compared. `producer.host` is hidden from every redacted view.
- `GET /healthz` carries `package` `{hash, files}`, a short hash of the host's own Python and JSON files (the page's files
  were already in `version`); null when they cannot be read.
- The page (theme spec section 22): a reporter's row says its adapter or "version unknown" and "older adapter" when
  flagged; opening it gives Adapter, Pusher, Runs on and a Version gap line per reason in words; an opened machine row
  gives each reporter's adapter, pusher and host on one Software line; a watch-strip chip and a
  trust-line note per flagged source; a SOFTWARE section on the phone. No new creature, light or number.
- Bundled adapter 1.11: sends `producer.host`, `producer.pusher` and `producer.meaning[]` (an adapter older than 1.7
  cannot send agent state, queues or deploys; one older than 1.10 reads a machine with no quota tool as a failed meters
  collector, not as off). Feed 1.3.
- The demo scenario `version-skew` (`lookout run --demo --scenario version-skew`): one machine on the newest adapter, one
  two releases behind (flagged, with reasons), one that never said (version unknown).
- Contract tests `tests/test_skew.py` under the owner's extended exception (CONTRIBUTING.md).

### Checked on
- Headless Chrome at 390 x 844, 1440 x 900 and 1920 x 1080 on the `version-skew` demo (three synthetic machines): the
  reporter rows, the opened row's Version gap lines, the watch-strip chip, the trust-line note and the phone's SOFTWARE
  section; no page wider than its window. Not run on a real Safari or TV (see the device checklist).

### Fixed
- The 0.4.1 changelog named a provider in a line the self-audit rejects; reworded.

## [0.4.1] - 2026-10-10

The open sea: on a TV with nothing waiting on you, the sea is the board's picture, not a small window beside a text
panel. No feed change: feeds of any 1.x version get all of it. The bundled adapter is 1.10 (the meters collector can be
off).

### Added
- The open sea (theme spec section 21.6): on the TV layout with a scene, when no call and no unverified waiting number
  stands, the call plate collapses to one banner line ("NOTHING WAITS ON YOU · 22 under way, 0 off course, ..."; read
  in full to a screen reader, still the Bridge's door) and the scene takes the whole upper area. A call brings the
  panel back at once; the last call answered opens the sea again. A theme opts in with a `zones.tv.open` zone set.
- The roadstead's stretches (`src/lookout/fleet.py` `roadstead`, the view's `fleet.roadstead`, the scene's
  `fleet.slots`): the window's width shared among the ships drawn, the flagship's first, then one equal stretch per
  escort, then the convoy's; decided only by how many ships sail, never by state. No escort ever covers another escort
  or the lighthouse.
- Full-scale escorts: on the open sea with three ships or fewer, each escort is drawn with the flagship's own art (its
  sailors at their stations, station furniture, scouts in its nest), a little further off, with its own plate under its
  hull (and its own "+N BELOW"), weather, fog, lantern, gulls and float. Four to six ships keep half-scale escorts, one
  stretch each across the horizon.
- The rainbow (theme spec section 17): a critical that clears brings a rainbow behind the ship it was on (the flagship
  when it named no machine), kept to that ship's stretch; never while another critical is open (then in words).
- Last seen (`web/sightings.js`, section 17.4.1): the key lists each creature kind (longboat, dolphins, whale, rainbow,
  gulls) with its last time on this screen and the report that brought it ("Longboat home: ..."), or "not yet on this
  screen"; an event that was only told in words says so. Kept in the tab's session storage, like the logbook.
- The replay key (`R`, or REPLAY in the key): plays the newest real creature event once more, said as a replay in the
  bar, the logbook and the scene receipt. Only the newest: when it cannot be played as it was, or there is none,
  nothing plays; never an older or a made-up event. It obeys the board (no replay during an alert's motion, a critical,
  at anchor or under still), is not a sighting, rings no sound and does not count against the rate caps.
- Contract tests `tests/test_roadstead.py` under the owner's extended exception (CONTRIBUTING.md): the slot plan, the
  last-sighting bookkeeping and the replay's choice of event (the latter two run `web/sightings.js` in Node when it is
  installed).

### Changed
- The first-visit hint never shows on the TV layout (a TV, a wall screen, any window 700 CSS px or wider): a screen with
  no pointer and no remote could never dismiss it, and it covered the escorts. The phone keeps its one-tap hint; the
  TV's `hint` zone is gone from both themes.
- Weather and fog are drawn clipped to their own ship's stretch: a silent escort still shows its own fog (and a
  critical its own storm), honestly, and never fogs a neighbour. Only lost contact fogs the whole sea.
- Beside a call, half-scale escorts lie in one row in their own stretches (they no longer alternate rows over each
  other); their plates take turns above the masthead and under the hull, so they keep their words.
- The key (`?`) spans the upper area: the shapes and the sea on the left, last seen on the right, the replay in its head.
- Bundled adapter 1.10: `quota_providers` `[]` or `null` turns the meters collector off (not run, not an error, not
  shown as failed; the feed carries no meters collector), and so does `"auto"` with no `quota-axi` on `PATH`; `check`
  says "meters: off (no providers configured)" (or "meters: off (auto, and no quota-axi on PATH)"). Only a listed
  provider whose `quota-axi` is missing is an error, and `check` now fails on it.

### Checked on
- Headless Chrome 150 and WebKit (Playwright, software rendered), one browser at a time, at 1920 x 1080, 3840 x 2160
  and 390 x 844 (DPR 3), on throwaway fleets of 1, 3 and 6 machines with synthetic names (a silent one, a draining one,
  a reserved one, a sleeping one), each with nothing waiting and with a call waiting, and the sea-life demo: the open
  sea and its return beside a call, the escorts in separate stretches with their own plates (no two plates touching),
  the silent escort's fog over itself only, no TV hint, the key with last seen and the replay. No console errors (the
  only WebKit lines are Playwright's own style injection refused by the content security policy, as before) and no page
  wider than its window.
- The sea-life demo after the layout change: every creature played and was shot as it did (longboat with dolphins,
  whale, a two-chest longboat, gulls off and back, and the rainbow when the critical clears); the key's last-seen lines
  named each one, and `R` replayed the newest (said as a replay). The same five on the open sea of a calm three-ship
  fleet (real feed changes pushed one at a time), with full-scale escorts.
- The three real feeds recorded for 0.3.1, time-shifted and replayed before (0.4.0) and after: the same lanes and
  counts; before, the first-visit hint over the escorts and the two escorts stacked by the lighthouse; after, one banner
  line and the three ships across the sea, each with its own plate.
- The adapter's meters rule on a fixture home and on a home with no `quota-axi` at all: `[]`, `null` and `"auto"`
  without the tool give no meters collector and an `ok` check line; naming the one provider without it is an error and fails check.
- Cost: the box was loaded by other work (load average 7 to 18), so CPU over wall time was noisy for every release (0.4.0
  read 1.7 to 4.6% of one core on the same pages). Measured instead in the page, interleaving 0.4.0 and 0.4.1 round by
  round: the scene's paint per ambient frame is 0.38 ms for three ships on the open sea in both, 0.43 vs 0.52 ms on the
  real fleet, 0.46 vs 0.43 ms for six ships; at 8 frames a second that is under 0.5% of a core. Full-scale escorts float
  with one blit each, as half-scale ones do.
- Person-only checks are in docs/device-checklist.md, "The open sea": a real TV at viewing distance and at 4K, a TV with
  no pointer, Safari and an iPhone.

## [0.4.0] - 2026-10-10

One ship per machine: the sea is the fleet. A ship is wherever work runs (the feed's machine id: a laptop, a desktop, a
CI service); the flagship is the primary source's machine. No feed change: feeds of any 1.x version get all of it. The
bundled adapter is 1.9 (one `check` change).

### Added
- The fleet (`src/lookout/fleet.py`, the view's `fleet`; feed spec "The fleet", theme spec section 21): the flagship,
  a fixed order (the flagship, then `display.fleet.order`, then by name; never by state, so ships never swap places), the
  ships drawn (`display.fleet.max_ships`, at most 6) and the convoy past them.
- The TV roadstead (ship deck): the flagship in front at full scale with its own crew; up to five escorts behind it at
  half scale, drawn natively at that size (8 x 12 sailors), each with its own hull plate (name and pip word: OK,
  DRAINING, ALERT, SILENT, LOST, ASLEEP; reserved and maintenance neutral as in 0.2.0), its own weather from its own
  machine (storm, rain, fog), sails set, slack (becalmed) or furled, its lantern, gulls and one sailor per lane at the
  station for its stage. An idle, healthy machine moors in its own slot by the harbor quay; a sleeping one
  (`display.may_sleep`) lies at anchor with a dim lantern; silence never moors. Past six ships the rest gather as a
  convoy with a count plate ("+3 SHIPS · 1 ALERT"), whose count is always the total.
- Each escort is a door to its own ship's places (its decks filtered to its machine), with a dashed frame and a caption;
  the convoy opens the Crow's nest. Doors are reached in reading order, left to right.
- Below decks: a ship carries on deck only the sailors that fit (an escort six), the most urgent first; the rest are said
  in words: "+6 BELOW" on the flagship's plate, "6 more below decks" in the scene receipt.
- Phone: a convoy strip under the call: every ship in the fleet's order as a mini ship with its pip, name and word,
  scrolling sideways inside itself; tapping one opens its places. The scene module's new optional `mini` draws them;
  a theme without it shows the same doors without art.
- The scene receipt names each ship's role and berth and the convoy; the key and the Logbook's legend explain ships.
- Contract tests `tests/test_fleet.py` under the owner's extended exception (CONTRIBUTING.md).

### Changed
- The flagship no longer carries every machine as a deck section (four at most): it carries its own machine's crew,
  and its masts follow its length. With one machine the board looks as in 0.3.1.
- Every list of machines (the phone bar's pips, the plain theme's panel, the Crow's nest) follows the fleet's order.
- A machine asleep in quiet hours (`display.may_sleep`) is no longer fogged over: it lies at anchor with a dim lantern
  and reads ASLEEP; its rows keep their last-known marks.
- Bundled adapter 1.9: its `check` command no longer fails a collector that is merely slow. A check with a fixed
  ceiling (the source board at its own timeout setting, each deploy read at 10 s) that answers past its ceiling but within
  `check_slow_factor` (3) times it is a warning with the measured seconds while the push log is healthy ("source board:
  answered (took 61.2 s, over its 45 s ceiling; the push log is healthy, so it is slow, not failing)"); it fails only
  when stopped at that bound or when the push log is not healthy.

### Checked on
- Headless Chrome 150 and WebKit (Playwright, software rendered), one browser at a time, at 1920 x 1080 and 390 x 844
  (DPR 3, and DPR 1 for width), on throwaway fleets of 1, 3, 6 and 9 machines with synthetic names (a silent one, a
  draining one, a reserved idle one, a sleeping one, an alerting one, an idle one and a becalmed one): the roadstead,
  the plates of every ship (never touching; the convoy's count never cut), keyboard only from Tab to an escort's door
  (its dashed frame and caption), Enter into that ship's places and Esc back to the sea; on the phone the convoy strip
  and a tap into a ship and back. No page wider than its window; the only WebKit console lines are Playwright's own
  style injection refused by the page's content security policy, as before.
- The three real feeds recorded for 0.3.1, replayed before (0.3.1) and after: the same lanes and counts; the primary
  source's machine in front, the other two on the roadstead, each with its own plate; the anchor screen with the escorts furled beside the
  sleeping flagship; the lost-contact screen fogs every ship.
- The ambient sea's cost with `#ambient=stats` for 1 to 7 machines (a fresh browser each, 40 s, 1920 x 1080): 1.39 to
  1.71% of one core and 0.73 to 0.86 ms a frame at 8 frames a second (0.3.1 on the same three machines: 1.41%), within
  the 3% budget.
- Also fixed on the way: at 390 px wide with a device pixel ratio of 1, the phone log's head ("0 WAITING, OLDEST 1 D
  17 H") and a long state word could widen the page; they now wrap (0.3.1 had the same on such data).
- Not yet: a real Safari on macOS, an iPhone and the TV (`docs/device-checklist.md`, "One ship per machine").

## [0.3.1] - 2026-10-10

At a glance: the board says what changed since a screen last looked, how long everything has been as it is, groups
work by project, says every time in plain words, and shows what each thing on it opens and means. No feed change: feeds
of any 1.x version get all of it. The bundled adapter is 1.8 (one plain-words change).

### Added
- Since you last looked: a screen that comes back (opened again, or its tab shown again) after
  `display.since_last.min_away_min` (10) says what landed, which calls are new and what newly got stuck since its last
  look ("Since you looked 3 h ago: 4 landed · 1 new call · 2 newly stuck"), until GOT IT or `show_min` (15). The look is
  kept only in that browser (`localStorage`, opaque keys and a time) and never sent to the host; a browser that blocks
  storage shows nothing. The host hands every screen the same `glance.marks` (`src/lookout/glance.py`).
- Age in state on every lane row, next to its state word ("YOUR CALL 2 H 11 MIN"), and the oldest wait in the log head
  ("3 WAITING, OLDEST 2 D 4 H") and at the top of the phone's lists. Never guessed: a row with no time for its state
  shows none.
- Grouping by project first and machine second: `items[].row.order` and `glance.projects[]`, in an order that depends
  on names only. The TV log keeps off-course rows first; the rows below them, the phone's lists and the decks follow the
  project order; the Gun deck heads each project with its counts and names each row's machine.
- A one-time first-visit hint pointing at the ship ("The ship opens its decks"; without a scene, "Every plate opens its
  place"; on the phone, over the ship banner), gone for good on GOT IT, on opening any place or after
  `display.hint.show_s` (180) seconds shown.
- The key: a small `?` button and the `?` key open a legend plate with every glyph shape and its word and what the sea's
  things mean; the phone lists it at the end of its page.
- Doors on the stage: the lighthouse (the Logbook), a ship's perched gulls (its Crow's nest row), and a longboat or
  whale while it is out (the Cargo hold, the Chart room) open their place, like the ship; every one of them, and the
  ship, shows a dashed frame and a caption saying what it opens while pointed at or focused. The scene module names them
  in `layout().hits`. On the phone the ship banner opens the places.
- An optional auto-tour for a TV with no pointer (`display.tour`, off by default): after a while without input it visits
  the Bridge, Gun deck, Chart room and Crow's nest slowly and sails home; any input stops it. `#tour=1` forces it on,
  `#fresh=1` forgets this browser's last look and hint.
- Theme zones `since`, `key`, `legend` and `hint` (theme-spec section 20), in both bundled themes.
- Contract tests `tests/test_glance.py` under the owner's extended exception (CONTRIBUTING.md).

### Changed
- Plain words everywhere: "just now" and "under a minute" instead of "<1 min"; dates from a source (a hold's until, when
  work was filed) as "today", "yesterday", a weekday or "12 Oct", never an ISO date; timeline kinds without a configured
  word are said in words.
- The bundled adapter 1.8: the raw words it keeps for the opened row (`doing`, `state_detail`) lose the home's
  `[at=<epoch>]`, `[key=...]`, `[corr=...]` and `[ref=...]` stamps, so no epoch reaches the page.
- Never colour alone: a door outlined in amber also carries the `needs` glyph and says "needs action" to a screen
  reader; a backed-up queue says "backed up" in the watch strip and the Crow's nest.

### Fixed
- At 390 px wide with a device pixel ratio of 1 the page was 408 px wide: the phone's place doors no longer let a long
  place name ("Chart room", "Crow's nest") widen the page; the name wraps inside its door.

### Checked on
- Headless Chrome 150 and WebKit (Playwright, software rendered) at 1920 x 1080 and 390 x 844 (DPR 3, and DPR 1 for the
  width fix), on the `gaps` demo with both themes: the first-visit hint, a stored look three hours old (3 landed, 3 new
  calls, 1 newly stuck), the key from the `?` key, keyboard-only walks across the doors (the lighthouse focused shows its
  caption, Enter opens the Logbook, Esc twice comes home), hovering the ship, the Gun deck grouped by project, the
  auto-tour (`#tour=fast`: four places and home, then stopped by one key) and a browser that blocks storage (the board
  works, no since plate). A walk of every place and opened row finds no epoch, ISO time or internal label made by the
  page; what remains on the real feeds is the sources' own text (titles that quote a date or a code name).
- A replay of the three real sources (read only, recorded from the host's view) on 0.3.0 and on 0.3.1 with the same
  feeds: the same lanes and counts, ages on the rows, "15 waiting, oldest 21 h", and the page 390 px wide at DPR 1
  (408 before). Still owed, by a person: a real Safari on macOS, an iPhone, and the TV (docs/device-checklist.md, "At a
  glance").

## [0.3.0] - 2026-10-10

Black holes: the board now says where work waits while nobody looks. Feed schema 1.2, additive: 1.0 and 1.1 feeds are
read exactly as before. The bundled adapter is 1.7.

### Added
- Feed 1.2 item fields `agent` (`alive`, `ended`, `gone`, `unknown`, with `since`), `waiting_for`, `waiting_since` and
  `state_since`, and the `waiting_on` word `external`; top-level `queues[]` (shared resources work waits for) and
  `deploys[]` (deployed against merged); a collector's `label` and `stale_after_s`.
- No agent at the work: a lane whose agent's session ended, or whose endpoint is gone, for `thresholds.agent_gone_min`
  minutes (10) needs action, with the state word AGENT GONE and a Say box that says what to do. Never from quiet: an
  agent idle between turns, or waiting on a long run it launched, is alive.
- `src/lookout/gaps.py` and the view's `gaps{}`: age in state for every item (`items[].age`), work waiting outside the
  fleet with who and for how long, the oldest wait, shared queues (`display.queues.slow_min`, 30), what comes up by date
  (`display.coming_up.days`, 7), the shipping gap, and each collector's freshness (`sources[].freshness`).
- The watch strip: one last row of the TV log with queues, outside waits, merges not shipped and the next dates, in
  words that fit; phone sections WAITING OUTSIDE, QUEUES, SHIPPING and COMING UP; Chart room and Crow's nest rows.
- The answer age behind the waiting number on the call plate ("answer 12 min old"), and an old or failed collector in
  the trust line and the Crow's nest.
- Burn rate: an allowance chip counts down to the source's own projected exhaustion ("out in 3 h 10 min"); `countdown_s`
  and `back_in_s` in the chip. The running-out sentence now says both the countdown and the time.
- The demo scenario `gaps` (`lookout run --demo --scenario gaps`); demo dates (`until`, `filed`) move with the fixture.
- Contract tests `tests/test_gaps.py` under the owner's extended exception (CONTRIBUTING.md).
- The bundled adapter (`adapters/`) 1.7: `agent` from the busy-state record (`event=session-end`, current gen only) and the endpoint
  probes (the home summary's and its supervisor's unhealthy endpoints); `state_since`; outside waits from PR states and the
  home's contribution records ("upstream maintainer", "a reviewer", "landing after merge"), and an item for an open
  contribution whose lane is gone; optional `queue_source` (a slot runner's directory, read only by pid liveness, or a
  JSON file), with holders named by the lane whose pipeline run they are; optional `deploys` (deployed version from a
  command or a file, against a branch in a git checkout); collector labels; `check` reports each new source; the
  `gaps-lab` fixture.

### Changed
- The bundled adapter: row summaries say internal states in plain words ("working", "running tests", "fixing review
  findings", "in review", "stopped at review with 2 finding(s)"); the raw words stay in the opened row. A lane whose
  title is only its task id, or a bare slug, is titled in words ("Advance order").
- `lookout startup install` (Windows) starts the host through its logon task, so it keeps running after an SSH session
  logs off; without a task it warns over SSH that a host started now dies at logoff (`--no-start` leaves it for the next
  logon). The Windows and tower runbooks say to start the host through the task.

### Checked on
- Headless Chrome 150 and WebKit (Playwright, software rendered) at 1920 x 1080, 1200 x 800 and 390 x 844 (DPR 3), with
  the `gaps` demo, and a replay of the three real sources (read only, from the host's view) on 0.2.0, on 0.3.0 with the
  same feeds, and on 0.3.0 with one home's feed from adapter 1.7. Still owed, by a person: a real Safari on macOS, an
  iPhone, and the TV (docs/device-checklist.md, "Black holes").
- Known and older than this release: at 390 px wide with a device pixel ratio of 1 (not a phone) the page is 408 px wide;
  at DPR 3 it fits.

## [0.2.0] - 2026-10-10

The honest board: every row says plainly what is happening, only what needs someone is loud, and nothing is inferred
from silence. Feed schema 1.1, additive: a 1.0 feed is read exactly as before.

### Added
- Feed 1.1 item fields `project`, `summary`, `waiting_on` (`gate`, `pr`, `human`, `capacity`, `quiet_hours`) and
  `until`; machine `health.state` `reserved` and `maintenance` and `health.until`; allowance `provider`, `account` and a
  window's `short`; `events[].kind: "note"`, a one-off word for the Logbook.
- Five lane classes, decided on the host (`src/lookout/lanes.py`) and given in the view as `items[].lane`:
  needs action, running long, waiting, quiet and ok. Off course is needs action plus running long, nothing else.
- Row text from the host (`items[].row`): a project chip, the title without its repeated project, cut at a word
  boundary, and a one-line summary. The full words a source sent appear only inside the opened row.
- Machine strain against the machine's own norm (`machines[].strain`): struggling only when the load per core stayed
  above max(baseline x k, floor) for `sustain_min` minutes. Config `health`, defaults baseline 6 h, k 1.5, floor 1.0,
  10 minutes, after a 30 minute warm-up.
- Allowance chips from the host (`meters.chips`): provider, account, window, percent left and reset time, in a fixed
  order, as one last row of the TV log. Config `display.allowance.providers` limits them to the providers you list.
- Landed as a rolling 24 hours by default (`history.landed`), or since `display.landed.day_start`.
- Logbook notes from sources (`history.notes`), and the demo scenario `honest-board`
  (`lookout run --demo --scenario honest-board`).
- Stage scaling for in-between windows: whole device px while the stage fills at least `display.stage_min_fill` of the
  window, else a fitted scale in quarter device px (`display.stage_scale`: `auto`, `whole` or `fit`).
- Contract tests for the taxonomy, the chips and the feed contract (`tests/test_contract.py`; see CONTRIBUTING.md for
  why they are an exception).
- A support matrix in the README, and this changelog.

### Changed
- Waiting is drawn calmly and counted apart ("n waiting" replaces "n scouting" in the log header; scouts count as under
  way). An approval nobody has called for is waiting, in ink2; amber is only for what needs action, and a deck door's
  amber outline only for needs action.
- Declared rest (reserved, maintenance, draining) is neutral: no card (a draining machine no longer adds an `action`
  card), no amber, and a reserved or maintenance machine's silence is not an alarm (no SILENT, no trust-line problem, no
  gulls leaving). Only a lost machine gets a host card.
- When two sources send the same attention id with the same severity, the one whose source id sorts first is kept, so
  a card never alternates between sources.
- A lane an `action` card names counts as waiting on the viewer whether or not its source set `needs_you`.
- A relayed lane with no machine runs where its owning source does.

### Fixed
- Plates kept their old place after their words changed (a machine plate on the sea, a door on the ship's plan at
  1280 x 720): the page patched `style` as an attribute, which the content security policy blocks. It now goes through
  the CSSOM.
- The landed count in the top bar no longer overlaps its label.
- A long link or id in a row no longer widens the phone page.

### Checked on
- Headless Chrome and WebKit (software rendered) at 1920 x 1080 and 390 x 844, with synthetic fixtures and a replay of
  recorded feeds before and after. Still owed, by a person: a real Safari on macOS, an iPhone, and the TV the board
  runs on.

## [0.1.8] - 2026-10-09
- World: sailors at deck stations by stage; longboats, dolphins, gulls, whale, slack sails and the lighthouse, each
  driven by one feed field and written to the Logbook; opt-in sound; the `sea-life` demo scenario.

## [0.1.7] - 2026-10-09
- Decks: every plate is a door; the ship's plan and six places; items with the exact line to say; stepped zoom moves;
  one ship per machine, with stations.

## [0.1.6] - 2026-10-09
- The bundled adapter's sequence numbers resynchronise on a replay rejection.

## [0.1.5] - 2026-10-09
- One source for the waiting number (`waiting`), and the PR-open lane plate.

## [0.1.4] - 2026-10-09
- Ingest hardening: `Host` names, same-origin `Origin` and `application/json` required.

## [0.1.3] - 2026-10-09
- Push and received logs (`lookout received`); a push never waits on a slow collector.

## [0.1.2] - 2026-10-09
- Ambient sea: the ocean sways and the ship floats.

## [0.1.1] - 2026-10-09
- Adapter reads tool state files in place instead of running scripts.

## [0.1.0]
- First version: feed spec 1.0, host, merge, history, the page and its themes.
