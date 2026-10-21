# Contributing

Weatherdeck is a status board for machines and the work running on them (a TV or phone page fed by small pushers). It is not a monitoring or alerting system and not a hosted service. It is MIT licensed (see [LICENSE](LICENSE)), pre-1.0, and hobby tooling that its author open-sourced for problems they had. Contributions are welcome within that scope.

Community files: [SECURITY.md](SECURITY.md) (report a vulnerability privately), [SUPPORT.md](SUPPORT.md) (where questions go and what is supported), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Issue and pull request templates are under `.github/`; a board that showed something untrue has its own template, "the board showed something wrong".

## Scope

In scope: the host, the feed format, the page and its themes, the card (drop directory) contract, the documentation, and the example adapter. Out of scope: an adapter for one specific tool (it lives in its own repository and speaks the feed format in [docs/feed-spec.md](docs/feed-spec.md); see [docs/adapters.md](docs/adapters.md)), anything that needs a dependency, a build step, a CDN or telemetry, and anything that makes the board claim more than a feed says.

## How to propose a change

1. **Open an issue first** for anything non-trivial: a new feature, a change to what the board says, a change to the feed format, a new dependency of any kind. Say what problem it solves. A typo, a doc fix or a small bug fix can go straight to a pull request.
2. **Keep pull requests small**: one change, one reason. A large change is easier to take as several small ones, agreed in the issue.
3. Fork, branch from `main`, and send the pull request. Fill in the checklist in the template.

Response time: best effort, no promise. This is one maintainer's spare time; a pull request may wait weeks, and one outside the scope above may be closed with a reason.

## Rules the code keeps

- Standard library only, no build step, no CDN, no telemetry.
- Core code, schema, page, docs, fixtures and default config stay generic: no personal machine, host, account or project names, and no real tokens, paths or addresses. Fixtures are synthetic or redacted.
- Generic behaviour lives in the core and the feed spec; a tool's own mapping lives only in its adapter; personal choices (machine names, providers, quiet hours) live only in config. Feed changes are additive within a major version: a new field is optional, and without it the core behaves as before.
- **The honesty rule.** The board shows nothing without a real feed field behind it. Unknown, silent and stale are shown as such, never as fresh, never as zero, never as a made-up event. Words about what a tool did follow the same rule (see "Words" below and [docs/honesty.md](docs/honesty.md)).
- Keep the page readable from across a room (22 px minimum at 1080p), never rely on colour alone, and respect reduced motion.
- Python 3.9 to 3.14 is supported and 3.8 is not; say so the same way wherever a version is stated.
- Update `docs/feed-spec.md`, `docs/theme-spec.md` and `CHANGELOG.md` with every change to what the board says. The maintainer sets version numbers at release; leave the version as it is.

## Definition of done

Before you open a pull request, run these from a clean checkout of your branch, and say in the pull request that they passed:

1. `python3 -I scripts/self-audit`: the self-audit scans the tree for secrets, home paths and personal or vendor names. It must report nothing. It also takes your own list of private names to check against, `--denylist FILE`, which you keep outside the repository.
2. `python3 -m unittest discover -s tests`: the full suite. Standard library only, no network beyond a scratch loopback port; some page tests run in Node when it is installed and are skipped without it.
3. `scripts/merged-check`: this answers "does main plus this branch still pass?" against current `origin/main` (see below). Run it right before you hand off, and again if main moved. Your own gate passes on your own base; this one passes or fails the merge of your branch onto today's main.

A change that alters what the board says also updates the docs and the changelog, as above.

## Merged-result check

`scripts/merged-check [--head REF_OR_SHA] [--base origin/main] [--pr N] [--denylist FILE]` answers "does main plus this branch still pass?". Two
branches that each pass their own gate on their own base can be red together (one adds a rule or a rename, the other the text it now
catches), and there is no hosted CI to look at the merged result, so run it right before a merge. It runs `git fetch origin`, makes a scratch
clone in a temporary directory outside the repository (your working tree, branches and index are never touched), merges the head onto the base
there without committing, and runs in that merged tree `python3 -I scripts/self-audit` (with `--denylist FILE`, or `$MERGED_CHECK_DENYLIST`; keep
the file outside the repository) and the core suite (`python3 -m unittest discover -s tests`).
It prints one line, `merged-check: ok` or `merged-check: FAILED <step>: <first finding>` (a self-audit finding is shown as file, line and kind
only), puts the failing step's output on stderr, exits 1 when the merge conflicts or a check fails and 2 when it could not run, and always removes
its scratch clone. `--pr N` takes the head from `gh pr view`. The default head is `HEAD`, so commit first. When main moves, run it again.

## Release scan

`scripts/release-scan [--denylist FILE] [--allow VALUE ...] [--allow-file FILE] [PATH]` is the one command for the pre-release checks
(standard library and `git` only). It runs `scripts/self-audit` on the working tree (with `--denylist FILE` when you give one; keep that
file outside the repository) and then reads the history of **every ref** (branches, tags, remote and pull refs, stash) for:

- author and committer names and e-mail addresses that are not on the allow list (`--allow VALUE`, repeatable, a name or an address, matched
  whole and case-insensitively; or `--allow-file FILE`, one value per line, `#` for comments). With no allow list every identity is a finding;
- home paths and token shapes (the self-audit's patterns) in **added lines** of any commit, including a line a later commit removed;
- a shallow clone, whose history is incomplete.

It prints counts and kinds only, never the text of a hit (the self-audit's own output is reduced to kind counts too; run `scripts/self-audit`
on a machine you trust to see where a tree hit is), and exits 1 on any finding, 2 when it cannot run. It does not read commit or tag messages,
objects no ref reaches, or forge records such as pull request text. A history it reports as dirty cannot be cleaned by a later commit; the
release then starts from a fresh history.

## Tests

`python3 -m unittest discover -s tests` runs the suite: standard library only, with no network. An adapter for a specific tool is tested in its
own repository, not here.

- `tests/test_smoke.py`: behaviour through the public `weatherdeck` command, and the self-audit.
- `tests/test_merged_check.py`: **added at the owner's request, for `scripts/merged-check` only**: scratch git repositories with a bare origin and
  synthetic text; two branches clean alone and red merged, a conflicting merge (exit 1, file named), a clean merge (exit 0), and that the caller's
  repository and the temporary directory are left as they were.
- `tests/test_release_scan.py`: **added at the owner's request, for `scripts/release-scan` only**: scratch git repositories in a temporary
  directory with synthetic identities, home paths and tokens (assembled at run time); checks the counts, the exit status and that no hit is printed.
- `tests/test_contract.py`: **contract tests, added in 0.2.0 as a deliberate, narrow exception** to the rule that
  tests cover only the core contract. The owner asked for them for exactly three things: the lane
  taxonomy (`src/weatherdeck/lanes.py`), the allowance chips and their projection rule (`src/weatherdeck/allowance.py`), and
  the feed-spec contract (`src/weatherdeck/schema.py`). Their data is synthetic (no real names, paths or providers), and
  they are small and deterministic (every time is passed in). Tests for adapter glue, themes or other code are
  not added without agreeing it in an issue first.
- `tests/test_gaps.py`: **added in 0.3.0 under the same exception, which the owner extended to this release** for
  pure core logic and the feed-spec contract only: the agent rule (`src/weatherdeck/lanes.py`), age in state, outside
  waits, queues, coming up, the shipping gap, collector freshness and relative time (`src/weatherdeck/gaps.py`), the
  burn-rate countdown (`src/weatherdeck/allowance.py`) and the 1.2 feed fields (`src/weatherdeck/schema.py`). The same rules
  hold: synthetic data, standard library, no network, every time passed in; still no tests for adapter glue or themes.
- `tests/test_glance.py`: **added in 0.3.1 under the same exception, which the owner extended to this release** for
  pure core logic and the view contract only: since you last looked (the opaque marks and the delta), grouping by
  project then machine (`src/weatherdeck/glance.py`), age in state and the oldest wait (`src/weatherdeck/gaps.py`) and relative
  time. The same rules hold: synthetic data, standard library, no network, every time passed in; still no tests for
  adapter glue, the page or themes.
- `tests/test_fleet.py`: **added in 0.4.0 under the same exception, which the owner extended to this release** for
  pure core logic only: the flagship, ship order, the ships drawn and the convoy past them, berths, the hull word per
  machine state and the convoy's count plate (`src/weatherdeck/fleet.py`). The same rules hold: synthetic data (tree
  names), standard library, no network; still no tests for adapter glue, the page or themes.
- `tests/test_skew.py`: **added in 0.5.0 under the same exception, which the owner extended to this release** for pure
  core logic and the feed-spec contract only: version parsing and the gap rule (`src/weatherdeck/skew.py`: what a feed says
  about its software, which source is flagged and why, unknown stays unknown) and the 1.3 `producer` fields
  (`src/weatherdeck/schema.py`). The same rules hold: synthetic data, standard library, no network; still no tests for adapter
  glue, the page or themes.
- `tests/test_debounce.py`: **added in 0.6.0 with the machine-alert debounce under the same exception** for pure core
  logic only: which cards are machine alerts and the two-feeds-to-raise, two-to-clear state (`src/weatherdeck/debounce.py`).
  The same rules hold: synthetic data, standard library, no network; still no tests for adapter glue, the page or themes.
- `tests/test_roadstead.py`: **added in 0.4.1 under the same exception, which the owner extended to this release** for
  pure core logic only: the roadstead's slot assignment (`src/weatherdeck/fleet.py` `roadstead`), and the page's sightings
  (`web/sightings.js`: each creature kind's last sighting and the choice of the one real event a replay may play). The
  sightings file is plain JavaScript with no page in it; its tests run it in Node when Node is installed and are
  skipped otherwise. The same rules hold: synthetic data, standard library, no network; still no tests for adapter
  glue, the rest of the page or themes.
- `tests/test_pace.py`: **added after 0.6.0 (unreleased) under the same exception, which the owner extended to this release** for pure
  core logic and the feed-spec contract only: a source's pace as the view says it (`src/weatherdeck/gaps.py` `pace`) and the
  1.4 `pace` field (`src/weatherdeck/schema.py`). The same rules hold: synthetic data, standard library, no network; still no
  tests for adapter glue (the pace decision, the CPU ledger and the back-off live in an adapter and are checked there by
  measurement), the page or themes.
- `tests/test_ledger.py`: **added after 0.6.0 (unreleased) under the same exception, which the owner extended to this release** for pure
  core logic only: the tool value ledger's line contract and the reading rule (`src/weatherdeck/ledger.py`: unknown stays
  unknown, coverage, KEEP, QUIET, CUT-CANDIDATE, UNMEASURED and when a number may be cited). The same rules hold:
  synthetic data (made-up hosts and counts), standard library, no network; the one file it touches is a temporary ledger
  it writes itself. Still no tests for adapter glue, the page or themes.
- `tests/test_ledgercards.py`: **added after 0.6.0 (unreleased) under the same exception, which the owner extended to this release** for pure
  core logic only: the card a tool's ledger becomes (`src/weatherdeck/ledgercards.py`: no ledger yet is never a number, an unknown
  says why, covered, partial and blind counters, keep, quiet and cut candidate, off by default). The same rules hold: synthetic
  data, standard library, no network; the only files it touches are temporary ledgers it writes itself. Still no tests for adapter glue, the page or themes.
- `tests/test_goals.py`: **added after 0.6.0 (unreleased) under the same exception, which the owner extended to this release** for pure
  core logic and the feed-spec contract only: the 1.7 `goal` and `goals[]` fields (`src/weatherdeck/schema.py`), the view's goal headers
  (`src/weatherdeck/goals.py`: counted over the merged rows, "or more" kept) and what a guest view drops (`src/weatherdeck/view.py`). The same
  rules hold: synthetic data, standard library, no network; still no tests for adapter glue, the page or themes.
- `tests/test_lanestate.py`: **added after 0.6.0 (unreleased) under the same exception, which the owner extended to this release** for pure
  core logic and the feed-spec contract only: the 1.5 `lane` and `say` fields (`src/weatherdeck/schema.py`), what a guest view
  drops of them (`src/weatherdeck/view.py`). The same rules hold: synthetic data, standard library, no network, every time passed in; still
  no tests for adapter glue, the page or themes.
- `tests/test_boardlink.py`: **added after 0.6.0 (unreleased) under the same exception, which the owner extended to this release** for pure
  core logic and the feed-spec contract only: the 1.6 `answer_link` field (`src/weatherdeck/schema.py`), what the television, guest and public
  views drop of it (`src/weatherdeck/view.py`). The same rules hold: synthetic data, standard library, no network, every time passed in; still
  no tests for adapter glue, the page or themes.

- `tests/test_stalecalls.py`: **added after 0.7.0 (unreleased) under the same exception, which the owner extended to this release** for pure
  core logic and the feed-spec contract only: the 1.8 `as_of` field (`src/weatherdeck/schema.py`), a call's answer age against its source's
  limit (`src/weatherdeck/gaps.py`), the host's merge of a call two homes both list (`src/weatherdeck/view.py`: the owner dropped it, so no card). The same rules hold: synthetic data, standard library, no network, every
  time passed in; still no tests for adapter glue, the page or themes.
- `tests/test_calloptions.py`: **added after 0.7.0 (unreleased) under the same exception** for pure core logic and the feed-spec contract
  only: the 1.9 `options` field (`src/weatherdeck/schema.py`) and what the television, guest and public views drop of it (`src/weatherdeck/view.py`).
  The same rules hold: synthetic data, standard library, no network, no clock; still no tests for adapter glue, the page or themes.
- `tests/test_redaction.py`: **added after 0.10.1 (unreleased) under the same exception** for pure core logic only: that the household, guest and
  public views carry no unknown field and none of a machine's pressure reasons, a list's cut reason, a source's pace reasons, a version gap's sentence or the Logbook's notes
  (`src/weatherdeck/view.py`, `src/weatherdeck/allowlist.py`). The same rules hold: synthetic data, standard library, no network, no clock.
- `tests/test_ledgerwriter.py`: **added after 0.7.1 (unreleased) under the same exception** for pure core logic only: the lines the host's
  own ledger writer derives from its history (`src/weatherdeck/ledgerwriter.py`: counts with their range and the digest of exactly the rows
  counted, sample rows left out and counted, a day with no push is unknown and never a zero, a floor of nothing is unknown, silence
  episodes, opaque source keys, what stays unknown names its field), the file rule (appended once, byte for byte, atomically; a ledger
  the reader cannot read is left as it is; a day closes after a grace; a capped run leaves the rest; a day held under any label is not
  written again) and the install rule (the salt is created once, private and stable; two installs key a source differently; a renamed
  host keeps its first label). The same rules hold: synthetic data (made-up sources, counts and times), standard library,
  no network, every time passed in; the history is an in-memory copy of the host's schema and the only files touched are temporary
  ledgers, salts and state files it writes itself in a temporary data directory. Each rule was also checked by breaking it (mutation): the tests fail with it broken. Still no tests for
  adapter glue, the page or themes.
- `tests/test_livery.py`: **added after 0.7.1 (unreleased) under the same exception** for pure core logic only: the page's
  per-machine livery rule (`web/livery.js`: the FNV-1a hash of a machine id picks one of six tones, a machine keeps its tone, no id or
  no six tones draws no livery, and what a flagship and an escort carry). Like the sightings file it is plain JavaScript with no page
  in it; its tests run it in Node when Node is installed and are skipped otherwise. The same rules hold: synthetic ids, standard
  library, no network; still no tests for adapter glue, the rest of the page or themes.
- `tests/test_weather.py`: **added after 0.7.1 (unreleased) under the same exception** for pure core logic only: the page's
  weather-transition rule (`web/weather.js`: which machine words are tracked, a change only between two known words on consecutive
  feeds, none at first load or in still motion, and how much of a cloud and its rain each of the four steps draws). It runs in Node
  like the livery file and is skipped without it. The same rules hold: synthetic machine maps, standard library, no network; still no
  tests for adapter glue, the rest of the page or themes.
- `tests/test_library.py`: **added after 0.8.0 (unreleased) under the same exception** for pure core logic and the feed-spec
  contract only: the library's one word per mirrored folder (`src/weatherdeck/gaps.py` `mirrors`: each of the eight words from its one
  rule, the order the rules are tried, unknown stays unknown and never reads up to date, a silent source keeps its last word, a folder
  is retired or expected only by a declaration, the receipt's times on the host's clock), the 1.10 `mirrors[]` field
  (`src/weatherdeck/schema.py`) and what the household and public views keep of it (`src/weatherdeck/view.py`). The same rules hold:
  synthetic data, standard library, no network, every time passed in; still no tests for adapter glue, the page or themes.
- `tests/test_refusals.py`: **added after 0.8.0 (unreleased) under the same exception** for pure core logic only: the host's log of
  refused ingest pushes (`src/weatherdeck/server.py` `note_refusal`: one line per client address per 10 minutes, the last refusal per
  address kept, a real unauthenticated POST on a scratch port) and the first-token warning of `weatherdeck token new`
  (`src/weatherdeck/ingest.py` `loopback_http_sources`). The same rules hold: synthetic data, standard library, no network beyond a
  scratch loopback port, every time passed in; the only files it touches are in a temporary data directory; still no tests for adapter
  glue, the page or themes.
- `tests/test_beatpush.py`: **added after 0.8.0 (unreleased) under the same exception** for the machine beat's pure push logic only
  (`bin/weatherdeck-beat` `Pusher` and `deliver`: the `push` key of the beat file, `ok`, `refused` and `down` with the HTTP code or
  none, `since` as the start of the state, and a lasting outage said again in the log once an hour on an injected clock). Its only
  network is a stub host on a scratch loopback port that the test starts and stops itself, and its clock and HOME are the test's own.
  Still no tests for the samplers, the OS readers, the pressure thresholds or adapter glue.
- `tests/test_join.py`: **added after 0.8.0 (unreleased) because the task brief for onboarding slice 5 asked for them**: the acceptance
  tests of `weatherdeck invite` and `weatherdeck join --dry-run` (`src/weatherdeck/join.py`): the join string, the invite registry and
  the expiry the host enforces, and each named preflight failure reproduced against a host on a scratch loopback port (unreachable
  port, a port that never answers, a refused Host name, a bad or expired token through the 411/401 probe, an id taken, an injected
  clock skew, a machine id that disagrees) or from injected platform facts (the Windows Store alias, Python older than 3.9, no
  service manager, no write access, earlier installs). Synthetic data, standard library, no network beyond a scratch loopback port;
  the only files touched are in a temporary data directory and a temporary home. Still no tests for adapter glue, the page or themes.
- `tests/test_doctor.py`: **added after 0.8.0 (unreleased) under the same exception** for pure core logic only: each check of
  `weatherdeck doctor` and `doctor --host` (`src/weatherdeck/doctor.py`) has a fixture that makes it fail with its named reason, and a check
  that cannot be made says "not checked", never ok. The OS's answers (a systemd unit, a LaunchAgent, a Windows logon task and its wrapper,
  a Store-alias interpreter) are injected through `doctor.Facts`; the host is a real one on a scratch loopback port. The same rules hold:
  synthetic data, standard library, no network beyond that scratch port; the only files it touches are in temporary directories; still no
  tests for adapter glue, the page or themes.
- `tests/test_frontdoor.py`: **added after 0.8.0 (unreleased) under the same exception** for pure core logic only: the page's
  front-door rule (`web/frontdoor.js`: the routes and their round trip, the board as a view of the sea whose parent is the sea,
  which screen a route shows on a TV-sized screen, a phone and the television profile, take-over screens keeping the stage), a
  ship plate's badge counts (a card's own machine, else its source's, nothing guessed) and the trust line's source counts
  (`trustCounts`: a placeholder is left out of the total, a quiet source on a resting machine is counted apart, a source that
  reports counts), how a supervision alarm is worded (`supervisionAlarm`: whose it is and how old, critical only on
  evidence, "not reported" when the feed does not say), and the plain rows (`rowState`: one of six row words for each synthetic lane shape, run through the host's own
  `lanes.classify`, every sentence free of raw status words and task ids, an old failed record never Stuck, a run that died while
  waiting is Waiting on someone else; `fitTitle`: whole words, no open bracket, never one word, the chip gives way first),
  an instruction left unread (`steerNote`, through the page scripts: an idle lane's amber line, the undelivered and escalated cases, and
  "not reported" only in the opened row of a source that sends no such field), and the one sort (`sortRows` and the page's own `boardModel`, `pageGroups` and `listsPlan`
  run in one context over a synthetic fixture: the sea and the Lists page list the same first five rows in the same order, Waiting on you first, a stale
  record never above a live Working row, the order list read from `defaults.json`). Like the livery file it runs in Node and is skipped without it. The same rules hold: synthetic routes, ids
  and cards, standard library, no network; still no tests for
  adapter glue, the rest of the page or themes.
- `tests/test_waitingonyou.py`: **added after 0.8.0 (unreleased) as a task brief's named acceptance test** for the one waiting-on-you
  number: over one fixture of a critical, five action and an info card, the host's `counts.waiting_on_you` (`src/weatherdeck/view.py`
  `waiting_on_you`) and the page's rule (`web/frontdoor.js`: `cardTier`, `waitingOnYou`, `badgeCounts`) give the call band, the Lists
  header, the Bridge door and the ship plates the same five, the critical only as a Problem and the info card only as an FYI. The feeds
  go in through `weatherdeck ingest` into a temporary data directory; the page rule runs in Node and is skipped without it. Synthetic
  data, standard library, no network; still no tests for adapter glue, the rest of the page or themes.
- `tests/test_approvallanes.py`: **added after 0.8.0 (unreleased) as a task brief's named acceptance test** for approval lanes in
  the waiting-on-you number: over three synthetic fleets, five calls plus a lane with an open PR that no call names give six lines and
  six on the call band, the Lists header, the Bridge door and the ship plates (the lane whose PR a call links to is that call's line,
  a merged PR's lane is not counted, each line carries its reason); a lane with no call at all gives its line and the "sources
  disagree" badge; a call that names its lane by `item` gives one line and no badge; and the number's age. Host side
  (`src/weatherdeck/view.py` `lane_asks`, `counts.waiting_on_you`, `waiting_disagree`) through `weatherdeck ingest`, page side
  (`web/frontdoor.js` `askRows`, `laneAskCard`, `asksAge`, `asksDisagree`) in Node, skipped without it. Synthetic data, standard
  library, no network; still no tests for adapter glue, the rest of the page or themes.
- `tests/test_housekeeping.py`: **added after 0.8.0 (unreleased) as a task brief's named acceptance test** for readability slice 3:
  over a synthetic fleet shaped like a real one's old records (a lane paused after its PR merged whose worker's session ended, approvals
  whose PR merged or was closed, a failed record its books say a newer status replaced) beside live lanes, the host never calls the merged
  lane agent gone (`src/weatherdeck/lanes.py` `agent_gone`) nor counts the old approvals, and the page lists the old records under
  Housekeeping with their reasons, counts none of them (waiting on you, off course, trouble badges, the Gun deck's outline, Problems, the
  waiting count, the waits outside the fleet) and keeps the live lanes' words. The feeds go in through `weatherdeck ingest` into a temporary data directory; the page's
  own scripts (`web/frontdoor.js`, `model.js`, `page.js` and the rest) run in Node over the host's view and are skipped without it.
  Synthetic data, standard library, no network; still no tests for adapter glue, the rest of the page or themes.
- `tests/test_silentwords.py`: **added after 0.8.0 (unreleased) as a task brief's named acceptance test** for how a silent feed reads:
  the host's two derived view fields (`src/weatherdeck/view.py`: a source's `interval_declared`, a machine's `beat_seen`) and the page's
  wording rule (`web/frontdoor.js` `sourceSaying`, with the machine row and the trust line it feeds), over a silent feed with a fresh,
  a stale and no beat, a declared 20 s interval at 1.5x, 3x and 10x, and no declared interval. The feeds go in through the public ingest
  into a temporary data directory; the page half runs in Node and is skipped without it. Synthetic data, standard library, no network.
- `tests/test_firstmate_push.py`: **added after 0.10.1 (unreleased) as a task brief's named acceptance test** for the firstmate pusher
  (`examples/adapter/firstmate_push.py`), over recorded fixtures in `tests/fixtures/firstmate/`: a ledger written by firstmate's own writer
  in a scratch home beside cut, replayed, hostile and from-the-future variants of it, and `state/lane-capacity.json` files. Each ledger
  event lands in its one feed field; the ledger absent (nothing is pushed), empty, truncated mid-line or full of unknown events, members and
  versions still gives an honest feed; repeated records are one task, one state and one `done[]` row (a cleanup with no merge before it is a row that says so); no liveness, summary or call is ever
  invented; ledger text stays inert, cut text; lists are capped with `omitted[]`; the same files give the same feed; the home is left
  byte for byte as it was; and the host takes the feed without letting it replace a machine's own row. Each rule was also checked by breaking it
  (mutation): the tests fail with it broken. The feeds are checked with `weatherdeck.schema.validate` and one goes in through `weatherdeck ingest`
  into a temporary data directory. Synthetic data (made-up tasks, projects and PR addresses), standard library, no network; the only files it
  writes are in temporary directories.
- `tests/test_staticdemo.py`: **added after 0.7.1 (unreleased) with the static demo** for its contract only: the build
  (`scripts/build-static-demo`) carries the "DEMO: recorded synthetic feed" label and its demo files, passes the self-audit, and
  refuses to delete a folder that is not an earlier demo build; the recording (`examples/static-demo/recorded-feed.json`) has at
  least two frames, each with the host name replaced and every source named. Standard library, no network; the only files it
  writes are temporary builds. Still no tests for adapter glue, the rest of the page or themes.
- `tests/test_cuapush.py`: **added after 0.10.1 (unreleased) because the task brief for the Cua Spaces pusher asked for them, an exception to
  "an adapter for a specific tool is tested in its own repository"**: the acceptance tests of `examples/adapter/cua_push.py` over the
  hand-written fixtures in `tests/fixtures/cua/` (normal, offline host, crashed run, schema drift, signed out) and a command that is not
  installed: the mapping from `cua` output to machines, lanes, calls, events and an allowance chip, each gap staying a gap (an offline host is
  never ok and its runs are unknown, an unreadable answer is an error and empty, never zero), the feed limits, and that only read-only
  commands are run. The fixtures were not recorded from a live cua. Synthetic data, standard library, no network, no cua, an injected clock;
  every feed is checked with the host's own validator.

## Words

- Do not say "caught", "saved" or their near synonyms as a claim of what a tool did, on any surface (README, page text,
  docs, changelog), until a field records exactly that. Use the verb the record supports. The retired words and the honest
  verbs are listed in [docs/honesty.md](docs/honesty.md); see also [docs/ledger-spec.md](docs/ledger-spec.md).
