# Feed spec: `lookout.feed` 1.12

A **source** is anything that reports its own work: a build server, a laptop, a team's tracker, an
agent runner. Each source pushes one JSON document every few seconds describing its own state. A
**host** (this program) keeps the last good document per source and merges them into one board.
Sources are discovered, never configured: the first valid push from a new source id makes it appear.

Only the envelope is required. A minimal feed is a source id plus a list of items.

**Versions.** 1.1 (Weatherdeck 0.2.0) only adds optional fields, each marked "1.1" below: an item's `project`, `summary`,
`waiting_on` and `until`; the machine rest states `reserved` and `maintenance` and `health.until`; an allowance account's
`provider`, `account` and a window's `short`; and `events[].kind: "note"`. A 1.0 feed is read exactly as before, and a host
of any 0.2 version accepts both. A source that sends 1.1 fields to an older host loses nothing: readers ignore unknown fields.

1.2 (Weatherdeck 0.3.0) adds optional fields only, marked "1.2" below, for work that waits where nobody looks: an item's
`agent`, `waiting_for`, `waiting_since` and `state_since` and the `waiting_on` word `external`; top-level `queues[]` and
`deploys[]`; a collector's `label` and `stale_after_s`. A host of 0.3 reads 1.0, 1.1 and 1.2 feeds; a 0.2 host given a 1.2
feed ignores the new fields and shows the rest as before.

1.3 (Weatherdeck 0.5.0) adds optional fields only, all inside `producer` and marked "1.3": `host`, `pusher` and `meaning[]`,
so the board can say which software each machine's reports come from (see "Versions per machine"). A host of 0.5 reads
1.0 to 1.3; an older host given a 1.3 feed ignores the new fields.

1.4 (0.7.0) adds one optional top-level object, `pace`, marked "1.4" below: how far a source has stretched its own
intervals on purpose (a busy machine, battery power, a spent budget) and what it has cost against its own budgets. A host that has it reads 1.0 to 1.4 feeds; an older host ignores `pace` and shows the rest as before.

1.5 (0.7.0) adds two optional fields to an item, marked "1.5" below: `lane`, one fixed word for what the work is doing
with why, since when and its last word, and `say`, one sentence as template parts (see "Lane state"). A host that has them reads 1.0 to 1.5
feeds; an older host ignores both and shows the rest as before.

1.6 (0.7.0) adds one optional field to an attention card, marked "1.6" below: `answer_link`, where a call that waits on the viewer
can be answered on the source's own review board, when that was last checked, or why there is no link (see "Answer link"). A host that has
it reads 1.0 to 1.6 feeds; an older host ignores it and shows the rest as before.

1.7 (0.7.0) adds an optional `goal` to items, `next[]` and `done[]`, and one optional top-level list, `goals[]`, marked "1.7" below: the
goal each piece of work serves, in the owner's own words, and how many rows each goal has (see "Goals"). A host that has them reads 1.0 to 1.7
feeds; an older host ignores them and shows the rest as before.

1.8 (0.7.1) adds one optional field to an attention card, marked "1.8" below: `as_of`, when the answer behind the call was made (see
"Call as-of"). A host that has it reads 1.0 to 1.8 feeds; an older host ignores it and shows the rest as before.

1.9 (0.7.1) adds one optional field to an attention card, marked "1.9" below: `options`, the choices the call offers, as plain words
(see "Call options"). A host that has it reads 1.0 to 1.9 feeds; an older host ignores it and shows the rest as before.

1.10 (0.9.0) adds one optional top-level list, `mirrors[]`, marked "1.10" below: for each folder a source mirrors into a shared
repository, when its sync job last ran, how that run ended, origin's newest change to the folder and what is not in the repository yet
(see "Library"). A host that has it reads 1.0 to 1.10 feeds; an older host ignores it and shows the rest as before.

1.11 (0.9.0) adds one optional field to `waiting`, marked "1.11" below: `note`, the id of the attention card that explains an
unverified waiting number (see the `waiting` row). A host that has it reads 1.0 to 1.11 feeds; an older host ignores it and shows the
rest as before. Without `note` (a feed older than 1.11, or a source that has no such card) the page shows every card the source sent:
for a source whose number is unverified that is its own "unverified" line and, as well, the card that says the same in the source's
words, so the same fact reads twice until the source sends `note`. Nothing is hidden and no number changes.

1.12 (0.10.0) adds optional fields only, marked "1.12" below (see "Whose turn, dated holds and lanes per machine"): an attention card's
`actor`, `hold` and `verdict`; a `next[]` row's `hold`; a machine row's `lanes`; a lane's `branch`; and a collector's `made_at` and
`refresh_s`. A host that has them reads 1.0 to 1.12 feeds; an older host ignores them and shows the rest as before. Without them (a feed
older than 1.12, or a source that does not know) every card, row and machine reads exactly as before: nothing is set aside, no count moves.

```json
{
  "schema": "lookout.feed",
  "schema_version": "1.0",
  "source": { "id": "my-laptop" },
  "items": [{ "id": "build", "title": "Nightly build", "state": "running" }]
}
```

Rules that apply everywhere:

- Readers ignore unknown fields. Unknown enum values are shown generically. The household, guest and public views keep only the fields the host lists for them
  (`src/weatherdeck/allowlist.py`): an unknown field, an extension of your own, is in the full view and no other. In those views a field that holds a word, a version or a short name keeps only a legal one, so a sentence cannot ride in it. Where this spec lists the words, any other value becomes `unknown` where the field has that word (`items[].state`, `handoff.state`, `agent.state`, `progress.steps[].status`, `machines[].status`, a checkpoint gate's `value` and a tier's `verdict`, `progress.current.activity`, `runway.status`; `info` for `attention[].severity`, `none` for `progress.basis`) and null where it does not (`machines[].pressure.level`, `health.state`, `mem.native_pressure`, `items[].phase`, `link.state`, `reported.basis`, `collectors[].status`, `actor.role`, `last_word.verb`, `say[].decides`). Every other such field keeps one word of at most 40 characters, or null: `kind` (an item, a call, a queued row), `cause`, `hold.bucket`, `waiting_on`, `waiting.basis`, `mirrors[].outcome`, `attention[].verdict.state` (an unlisted word stays as sent, a sentence becomes `unknown`), an event's `kind`, a `say` part's `t`, `how`, `gate` and `verb`, `pace`, `runway.confidence`, a version (`producer`, its `pusher`, `beat`, a checkpoint's `live` and `next`, `skew[].since` and `newer_version`) and a producer's or pusher's `name`; `groups[].color` keeps a `#rrggbb` colour; `omitted[].surface` keeps a list's name, with the id of a machine in brackets when it is one machine's list (`items`, `machines[atlas].extras`); and a source's `kind`, a machine's `role` and `runq_basis`, a lane's own `state` (the words of "Lane state", for example "Can't tell"), a landed row's `via` and a meter's `provider`, `account`, `label`, `short` and `runway.source` keep a name of at most four words and 32 characters. A name the board draws as the entity's own (a machine's, a source's, a group's, a project's, a station's, and a queue's, deploy's, collector's or folder's `label`) is kept as sent: some have no id to fall back on, and a row's chip, the glance and the coming-up list copy them. Those views also drop `machines[].pressure.why`, `omitted[].reason`, `pace.why`, `producer.meaning[].effect` (as `skew[].effect`) and the Logbook's notes.
- Times are RFC 3339 UTC strings ending in `Z` (`2026-01-01T09:00:00Z`), except `events[].at`, which is Unix seconds. Dates (`next[].until`, `filed`) are `YYYY-MM-DD`. An item's `until` and a machine's `health.until` (1.1) take either a time or a date.
- Staleness is decided by the host's receive time, never by `generated_at`.
- Limits (a push over a limit is rejected, never truncated): body 256 KiB, strings 2000 characters, `items` 60, `attention` 30, `machines` 12, `next` 30, `done` 30, `events` 200, `groups` 16, `collectors` 20, `omitted` 50, `queues` 16, `deploys` 8, `goals` 20, `mirrors` 8. Links must be `http(s)` URLs; anything else becomes null. A list of objects with a null entry (`"items": [null]`), and a number that is not finite (`NaN`, `Infinity`) anywhere in the document, unknown fields included, are rejected like any other bad push.
- A higher major version is rejected with a reason and the source's last good feed stays on screen. Any `1.x` is accepted.

## Schema ids

The program was called Lookout before it was renamed Weatherdeck. The feed, card, beat and fixture schema ids (`lookout.feed`,
`lookout.card`, `lookout.beat`, `lookout.fixture`) keep that name on purpose. They are wire-protocol identifiers that every deployed
adapter and host already speak, not branding, so they are stable identifiers: a producer or host that renamed one would stop being
understood by every other one. A future major version may add a new-name alias that is accepted alongside the old id, never a
replacement.

| Schema id | Version(s) | Where it is defined | Producers (this repo) | Producers in other repos |
|---|---|---|---|---|
| `lookout.feed` | 1.0 to 1.12 (`schema_version`) | this file, `src/weatherdeck/schema.py` (`SCHEMA`) | `weatherdeck-beat` (with `--push`), `examples/adapter/push_example.py`, the demo feeds in `examples/demo/`, the concept fixtures | Any adapter for another tool ([adapters.md](adapters.md)). This repo cannot list them |
| `lookout.card` (and `$id` `lookout.card/1.0`) | 1.0 | `docs/ADDINS.md`, `src/weatherdeck/card.schema.json` | the example cards in `examples/cards/` | The tools those examples are named for: the doctor (`site-doctor`), the host pool (`host-pool`) and the release checks (`release-gate`) write cards for the board |
| `lookout.beat` | 1.0 | `docs/beat.md`, `bin/weatherdeck-beat` (`SCHEMA`) | `weatherdeck-beat` (the beat file) | none known; an adapter may read it |
| `lookout.fixture` | n/a | `concepts/*/fixture.json` | the concept fixtures | none |

## Envelope

| Field | Type | Notes |
| --- | --- | --- |
| `schema` | string, required | Always `lookout.feed` |
| `schema_version` | string, required | `MAJOR.MINOR` |
| `source` | object, required | See below |
| `producer` | object | `{name, version, boot_id, seq, mode, host, pusher, meaning[]}`; `version` is the adapter's. `host`, `pusher` and `meaning[]` (1.3) say which software the feed comes from, see "Versions per machine". `seq` increases within a `boot_id`; a repeat or lower value is rejected as a replay. `mode` is `live` (default) or `sample`; sample data is labelled on screen |
| `generated_at`, `interval_s`, `collect_ms` | time, integer, integer | `interval_s` is how often this source pushes (default 30); the page's live/late/stale levels are multiples of it. A source that pushes only when something changed declares its keepalive cadence here (the most it ever goes without a push), never the faster rate at which it checks |
| `collectors[]` | array | `{id, as_of, status (ok\|stale\|error\|disabled), error, warnings, label, stale_after_s, made_at, refresh_s}`: one per data collector, so a failed collector shows as unavailable instead of silently empty. Ids the page uses: `items`, `machines`, `queue`, `attention`, `meters`. `label` (1.2) is the collector's name on the board ("tracker"), `stale_after_s` (1.2) how old its answer may get; see "Freshness". `made_at` and `refresh_s` (1.12): when the copy the collector read was made by its maker and how often that maker remakes it, see "Whose turn, dated holds and lanes per machine" |
| `pace` | object | 1.4: the source's own back-off and what it costs, see "Pace" |
| `queues[]` | array | 1.2: shared resources work waits its turn for, see "Black holes" |
| `deploys[]` | array | 1.2: what is deployed against what is merged, see "Black holes" |
| `goals[]` | array | 1.7: the goals the work serves, each with how many rows it has, see "Goals" |
| `mirrors[]` | array | 1.10: each folder the source mirrors into a shared repository, from its sync job's receipt, see "Library" |
| `machines[]` | array | Health of machines, see below |
| `items[]` | array | Work items |
| `attention[]` | array | Things waiting on the viewer |
| `next[]`, `done[]`, `events[]` | arrays | Queue, finished work, optional log lines |
| `groups[]` | array | Names, colours and release checkpoints for groups of items |
| `meters` | object | Allowances such as quota or budget |
| `counts`, `omitted[]` | any, array | `omitted` says when a list was capped: `{surface, shown, total, reason}` |
| `waiting` | object | Optional: where this source's waiting-on-you number comes from. `{basis, verified, as_of, age_s, reason}`; `basis` is the source's own word for the path that produced the number (for example `cached` or `unverified`). With `verified: false` the source sends no `action` cards it cannot vouch for, and the page shows its share as unverified with `reason` (never as "nothing is waiting"). The host lists such sources in `counts.waiting_unverified`. 1.11 `note` (optional; absent means none): the id of one of this source's own `attention[]` cards that explains why the number is unverified, in the source's own words. The page already says "unverified" and the reason, so it leaves that card out of its list; it drops only a card whose id equals the `note` of the same source's unverified `waiting`, and no other card |

`source`: `{id, label, machine, station, kind, peers[], retired}`.

- `id`: stable, `[a-z0-9][a-z0-9._-]{0,47}`.
- `machine`: id of the machine this source runs on. Several sources may share a machine.
- `station` (optional): which part of that machine the source reports, when other sources report the same machine from elsewhere: a Windows host and the Linux guest (WSL) running on it are one machine with two stations (`"Windows"`, `"Linux (WSL)"`). The board shows one machine (one ship), its pip the worse of its stations, and each station's ages and vitals beside it.
- `kind`: any short word shown as a role (`primary`, `secondary`, `standalone`).
- `peers[]`: ids of other sources this one knows should also be reporting. Used only to say "X is not reporting" when X has never been seen.
- `retired: true`: asks the host to forget this source now.

## Objects

**`machines[]`**: `{id, label, role, status (ok|warn|down|unknown), as_of, reach{probe_ok, rtt_ms, last_ok_at, error}, load{l1, l5, cores, runq_per_core, ...}, mem{used_pct, swap_used_pct, avail_gb, swap_rate_pps_1m, ...}, io{}, pressure{level, why[]}, beat{seq, interval_s, age_s, cost{}}, health{state, since, reason}, disks[{label, free_gb, free_pct, warn_gb, crit_gb}], uptime_s, on_battery, extras[{label, value, severity}], lanes{running, total}}`. `lanes` (1.12): the lanes this source runs on this machine, see "Whose turn, dated holds and lanes per machine". A source reports its own machine and may report machines it probes. `extras` carries any product-specific health value (queue depth, worker pool state). Unknown values render as unknown, never as zero or green. The fields added in 1.0 for machine beats (all optional, see [beat.md](beat.md)):

- `load.runq_per_core`: runnable work per core, a 1-minute mean; `runq_now` is the last sample and `runq_basis` says what was counted. `load.psi_some10` and `load.busy_pct` are the CPU stall percentage (Linux) and CPU busy percentage (Windows).
- `mem.avail_gb`, `mem.total_gb`; `mem.swap_rate_pps` (pages swapped in plus out per second, last interval) and `swap_rate_pps_1m` (1-minute mean); `mem.paging_pps` (Windows pages per second); `mem.commit_pct`; `mem.compressor_gb`; `mem.psi_some10`, `psi_full10`; `mem.native_pressure` (`normal|warn|critical`, macOS).
- `io.busy_pct`, `io.psi_some10`.
- `pressure.level` (`ok|warn|critical`) and `pressure.why[]`, the plain-text reasons that made it so. The level is the reporter's judgement from memory pressure, swap rate, run queue per core and free disk, never load average alone.
- `beat`: the reporter of a machine's health samples it on its own schedule. `interval_s` is that schedule and `age_s` is how old the sample was **when the source built this feed**, measured on one clock (the file's age, not a wall-clock comparison across machines). The page adds the time since the host received the feed and applies the source levels to the beat's interval: live up to 2 intervals, late up to 4, stale up to `lost_after_s`, lost beyond. A late or stale beat is drawn as last known. `beat.cost{cpu_pct, rss_mb, collect_ms, over_budget}` is the sampler's own cost.
- `health`: a machine-reported status that is not a measurement. `state` is `ok`, `draining` (the machine answers but should get no new work), `reserved` (1.1: its owner has it for something else), `maintenance` (1.1: it is being worked on) or `lost` (it does not answer); `since` is when it began, `reason` is plain text, `until` (1.1, a time or a date) when it is expected to end. **Any source may report it for any machine**, so a source that watches a remote host, or the tool that reserves a machine, can say so without owning the machine's row: across all rows of one machine the host keeps the strongest declaration, maintenance over reserved over lost over draining, newest first, and drops one whose `until` has passed.

**Declared rest is neutral.** A machine that is `reserved`, `maintenance` or `draining` is drawn calmly with its word ("Reserved until 14:00") and its reason: no card, no amber, no alarm. A reserved or maintenance machine is expected to go quiet, so while the declaration holds its sources' silence is not an alarm either: the machine never reads SILENT or LOST, the trust line does not list its sources, and no gulls leave it. Its items keep the source rules (last known). A reserving tool can say it with one push (its own source id, an `interval_s` as long as it means to re-push, and `machines: [{"id": "<machine>", "health": {"state": "reserved", "reason": "...", "until": "..."}}]`), and clears it by pushing `"state": "ok"` or `source.retired`.

The host also derives `health.state: "lost"` itself when the source carrying a machine's row is reporting but `beat.age_s` plus the time since receipt is beyond `lost_after_s` (a host that stopped beating while its reporter lived), unless the machine declares rest. A source that is itself silent is already drawn by the source rules, so it adds no second card.

**Machine strain** (host-derived, 1.1 views). "Struggling" is judged against the machine's own norm, never a fixed line: the host keeps, per machine and station, a slow moving mean (the baseline) of its load per core (`load.runq_per_core`, else `load.l1 / load.cores`), and the view's `machines[].strain` is `{state (ok|struggling|unknown), value, baseline, threshold, since, sustained_s, warm}`. A machine is struggling only when every sample for `sustain_min` minutes was above `threshold = max(baseline x k, floor)`, and never before the baseline has `warmup_min` minutes behind it. Config `health` (defaults): `baseline_hours` 6, `k` 1.5, `floor` 1.0 (runnable per core), `sustain_min` 10, `warmup_min` 30. The machine's word reads struggling for that, for a disk below its `warn_gb`, on battery, or for a reporter's own `pressure.level: critical` (a memory or swap emergency is absolute; the norm judges load); with a norm to judge by, the reporter's own `status: warn` or `pressure.level` alone does not, and is shown as a detail. A machine with no load figures keeps its source's own word.

**`items[]`**: `{id, owner, relayed, group, machine, kind, title, doing, state, state_detail, started_at, last_event{state, text, at}, progress, handoff{state, since}, link{url, label}, flags[], needs_you, phase, project, summary, waiting_on, until, waiting_for, waiting_since, state_since, agent{state, since, as_of, reason}, lane{state, cause, since, last_word{verb, at}, short_title}, say[], goal}`.

- `title`: a plain name for the work. `project` (1.1): the short name of what it belongs to, drawn as a chip before the title; without it the chip is the item's group label. A title that starts with its project ("Harbor: fix the login loop", "[Harbor] ...", "Harbor - ...") is drawn without the repeat.
- `summary` (1.1): one line, in plain words, of where the work is ("tests running, 2 of 5 suites"). It is what a row says. Without it a row says `doing` (or `state_detail` for work that is not running), on one line. A source should put a status line it does not control into `doing`/`state_detail` and its own reading of it into `summary`: **the board never shows a raw status line on a row**; `doing`, `state_detail`, `last_event` and the full title are shown only inside the opened row.
- `waiting_on` (1.1): for work that is held, what holds it: `gate` (a check or review gate), `pr` (a pull request upstream), `human` (a person who is not necessarily the viewer), `capacity` (a slot, a quota, a lane cap), `quiet_hours` or (1.2) `external` (someone outside the fleet: an upstream maintainer, a reviewer, a vendor). Unknown words are kept and shown as plain "waiting". `until` (1.1): when the hold is expected to end, a time or a date. Both are read only while the work is waiting or paused.

- `waiting_for` (1.2): who or what an outside wait is on, in plain words ("upstream maintainer", "a reviewer"). `waiting_since` (1.2): when the wait began. `state_since` (1.2): when the item entered its current state, the source's own time; without it the host measures the age from the best time the item carries (see "Black holes").
- `agent` (1.2): whether anyone is at the work, as the source knows it: `state` is `alive` (a live session, also when it is idle between turns or quiet while a long run it started goes on), `ended` (its session ended), `gone` (its endpoint, the pane or process it ran in, no longer exists, or the agent in it is dead) or `unknown`; `since` when that began, `as_of` when the source looked, `reason` plain words. Only a source's own record says ended or gone, never silence.
- `lane` (1.5) and `say` (1.5): one fixed word for what the work is doing and one sentence in template parts, see "Lane state". Not to be confused with the host's own `lane` in the view (see "Lanes on the board"): the view keeps the source's as `source_lane`.
- `goal` (1.7): the goal the work serves, as the owner's own words, see "Goals". Absent when no goal is set for it.
- `state`: `running`, `waiting`, `done`, `blocked`, `paused`, `failed`, `unknown`.
- `owner`: the source that owns the work (default: the pushing source). `relayed: true` marks a second-hand copy of another source's item.
- `handoff.state`: `none`, `awaiting_you` (needs the viewer's approval), `automatic` (finishes by itself), `complete`, `unknown`.
- `needs_you`: true when an `attention` item names this item.
- `phase` (optional, 1.0 readers ignore it): the stage the work is in, `plan`, `build`, `verify`, `ship`, `wait` or `land`. It says where, never how far. Without it the page derives the stage from the current step (config `display.stage_of_step`), and with no step it shows none; unknown is not build.
- `link`: `{url, label, state, state_as_of}`. For a pull request, `state` is `open`, `merged` or `closed` when the source knows it. The page's lane plate: a lane whose `state` is `failed`, `done` or `unknown` and whose PR is open reads "PR open, waiting on upstream/review" (calm), never FAILED; a merged PR reads as landed; FAILED only when the PR was closed unmerged, or there is no PR and the state is `failed`; a PR whose state is not known reads "PR recorded" (not FAILED). A lane at work, waiting or blocked keeps its own plate.

**`progress`** (honest percent): `{basis (history|default|coarse|none), history_n, percent_floor, percent_ceiling, regressed, reason, current, steps[]}`.

- A percent is a **range**, never an interpolation: `percent_floor` is the weight of finished steps, `percent_ceiling` adds the step under way. Nothing moves inside a step.
- Both are null, with a `reason`, when no percent is honest (a single long step, an investigation, a source that reports only state).
- `regressed: true` when the floor fell since the previous push (a retry or a restart); the page shows the jump rather than sliding.
- `current`: `{step, elapsed_s, typical_s, p90_s, round, activity (active|quiet|waiting|unknown), last_activity_age_s, waiting_since}`. Elapsed against typical and p90 lets the page say "running long".
- `steps[]`: `{id, label, status (done|current|pending|skipped|unknown), weight (0-1), elapsed_s, typical_s, p90_s, round}`. Weights should be measured typical durations, not step counts.
- A source that knows which phase work is in but not how far through it sends `steps` with `weight` null, the current one marked, and both percents null: the page writes the position ("2 of 4") where a percent would go, never a percent.
- Work is 100% when its last step is done; handing it over is `handoff`, not progress.

**Lanes on the board** (host-derived, 1.1 views). The host gives each item `lane: {kind, cls, waiting_on, until, asks_you}` (`asks_you`: an approval nobody has called for, with its PR open, which the waiting-on-you number counts as its own ask; see "How the host merges sources") and `row: {chip, title, summary}` (src/weatherdeck/lanes.py). `cls` is one of five classes, mapped from what the source says and never from silence:

| Class | When | Drawn |
| --- | --- | --- |
| `needs_action` | `failed` (unless its PR is open, see `link`), `blocked`, or a call names it: `state: waiting` with `needs_you`, or an approval (`handoff: awaiting_you`) that an `action` attention card names; or (1.2, kind `agent_gone`) its `agent` has been `ended` or `gone` for `thresholds.agent_gone_min` minutes (default 10) while the work is not done | amber where it calls, counted off course; the only class that lights a door's outline |
| `running_long` | running past `progress.current.p90_s`, or flagged `running_long` | counted off course, in words, no amber |
| `waiting` | `waiting` or `paused` without a call, an approval nobody has called for, a PR open or recorded upstream; with `waiting_on` and `until` | calm, counted apart ("3 waiting") |
| `quiet` | the source does not know the state (`unknown`, missing, or a word this host does not know); on the page also any item of a silent source that does not need action | fog, last known |
| `ok` | moving, scouting, on another round, landed | calm |

**Off course is `needs_action` plus `running_long`, and nothing else.** A lane that an `action` attention card names is treated as `needs_you` whether or not its source set the flag.

**No agent at the work** (1.2). A lane whose `agent.state` is `ended` or `gone`, for at least `thresholds.agent_gone_min` minutes counted from `agent.since`, is `needs_action` with kind `agent_gone`, whatever its state said: nobody will move it. Exempt: work that is done or failed (failed already needs action), and work whose PR is open or merged (its agent's part is over). An agent that is `alive`, `unknown` or not reported never changes the class, so an agent idle between turns, or waiting on a long run it launched, is never flagged.

**`reported`** (optional, on an item): `{label, percent, basis: "reported", at}`: a progress figure the worker states about itself (an agent saying "about 60%, writing tests"). It is never merged into `progress`. The page draws it as a separate dashed mark ("reported 60%, writing tests, 4 min ago") and, when `progress` has no honest percent, a dashed "~60%" marked "reported", because it is lower trust than measured, step-derived progress. No adapter has to send it; the public profile keeps the percent and drops the label.

**`attention[]`**: `{id, kind, severity (critical|action|info), title, detail, since, machine, item, group, link, answer_link, as_of, options, how, recommend, say, actor, hold, verdict}` (`actor`, `hold` and `verdict` are 1.12, see "Whose turn, dated holds and lanes per machine"). For something waiting on the viewer: `title` says what, `detail` why it needs them, `recommend` (optional) what the source recommends answering, `say` (optional) the exact line to type where `how` says to answer it (the board shows it with a Copy button and never sends it; every redacted view drops it), `link` where to look, `since` how long it has waited. Known kinds get an icon: `decision`, `approval`, `capacity`, `credential`, `machine`, `service`, `disk`, `info`. `how` says where to act (the board is read-only). Keep this list narrow: only what is genuinely the viewer's; the page's "waiting on you" number counts every `action` item, so a source says other trouble as `info` (or `critical`). The host adds one `machine` card per machine whose merged `health.state` is `lost` (critical), with id `host:<machine>:lost`; a source does not need to send it, and the card goes when the state does. Its words are labels (`host_lost_title`, `host_lost_how`, ...) so they can be changed in the config. (Before 0.2.0 a draining machine also got an `action` card; declared rest is now neutral, see `health`.) Keep setup hints and missing optional features out of `attention`: say them once as an `events[]` note.

**`next[]`**: `{id, group, title, kind (queued|gate|held), blocked_by[], reason, until, filed, goal, hold}` (`hold` is 1.12). **`done[]`**: `{id, owner, group, title, via, link, at, goal}`. (`goal` is 1.7, see "Goals".) **`events[]`**: `{at, item, kind, text}`. An event of kind `note` (1.1) is a one-off word for the Logbook: an optional feature that is off, a setup hint. Send each once (it is stored with the history), name the source by its id in the text, and never repeat it as an attention card; the view lists the newest few per source as `history.notes`.

**`groups[]`**: `{id, label, color, checkpoint}`. `checkpoint` is the optional release/milestone slot: `null` or `{as_of, live{version, since}, next{version, waiting_on[], items_ready}, gate{value (pass|fail|unknown), as_of, note, sha, tiers[{id, verdict (pass|fail|unknown|skipped)}], failing[], ship}}`. The gate is the floor verdict: `sha` is the exact commit it was run on, `tiers` a verdict per tier, `failing` the failing tests' names and `ship` the ship line, all optional. The board shows a "releases" panel only when some group has one. The `household` view drops `note` and `failing`; the `public` view also drops `sha` and `ship`.

**`meters`**: `{as_of, accounts[{id, label, machine, provider, account, windows[{id, label, short, percent_remaining, resets_at, pace}], runway{status (through_reset|exhausts_before_reset|exhausted|unknown), confidence, projected_empty_at, source}}]}`.

- `provider` and `account` (1.1): whose allowance it is and which account ("Orbit", "Team plan"); without them the host reads a 1.0 `label` "Provider, account". A window's `short` (1.1) is its name in a chip ("5h", "wk").
- `runway` is **the source's own projection**. The host never projects anything from percentages: the sentence "may run out Sun 23:08, before the Week reset Mon 07:08" exists only when the source says `exhausts_before_reset` with a `projected_empty_at`, and it always names the account it is about.
- Send only accounts the user uses. A provider whose tool is merely installed, with nothing measured, should send nothing (and say so once, as a note), not an "unavailable" account.

The view adds `meters.chips[]`, one per account in a fixed order (provider, then account, then id), never sorted by percentage: `{id, source, provider, account, window{id, label, short}, left, resets_at, resets, state (ok|low|out|unavailable), projection, sentence, forms[]}`, where `forms` are the chip's words from fullest ("Orbit Team plan wk 18% Mon 07:08") to shortest, for the page to fit. Config `display.allowance.providers` (default `[]`, every provider) lists the providers the viewer wants shown.

## Black holes (1.2)

What waits where nobody looks. The host derives each list in `src/weatherdeck/gaps.py` (pure, every time passed in) and the
view carries them as `gaps{waits_outside, oldest_waiting, queues, coming_up, deploys}`; the page draws them calmly, in
words, never in amber: they are things to know, not calls.

- **Age in state.** Every item in the view gets `age: {s, since, basis}`: how long it has been in its state, measured
  from `state_since`, else (for held work) `waiting_since`, else `handoff.since` for an approval, the current step's
  `waiting_since`, the last event when it reports this same state, and `started_at` for running work. Never from the
  push time. `gaps.oldest_waiting` is `{s, id, source}` for the item that has waited longest in the waiting or needs
  action classes.
- **Outside waits.** `gaps.waits_outside[]`: every lane classed waiting whose `waiting_on` is `external` or `pr`, oldest
  first: `{id, source, owner, title, chip, waiting_on, who, since, age_s}`. `who` is the item's `waiting_for`, else a
  plain word for the kind of wait.
- **Queues.** A source may report the shared resources its work waits for: `queues[]` `{id, label, machine, length,
  oldest_wait_s, held, cap, holders[{label, since}], as_of}` (`length` is how many wait; `oldest_wait_s` how long the
  oldest had waited when the source built the feed, a delta on its own clock; `held` and `cap` the places taken and
  how many there are; `holders` who holds them, at most 12). The view's `gaps.queues[]` adds `oldest_since` (the start of
  that wait on the host's clock, so the page keeps counting) and `state`: `clear` (nobody waits), `moving`, `backed_up`
  (the oldest waited `display.queues.slow_min` minutes or more, default 30) or `unknown` (no length). Fixed order:
  machine, label, id.
- **Coming up.** `gaps.coming_up[]`: dated holds and rests that end within `display.coming_up.days` (default 7), soonest
  first: queued work held until a date (`next[].until`), a held lane's `until`, a machine's declared rest
  `health.until`. `{at, date_only, date, kind (next|item|machine), id, source, title, word}`; a date with no time is
  that calendar day (`date`), listed through the whole day and never moved by a time zone.
- **Shipping gap.** A source may report how far what is deployed is behind what is merged: `deploys[]` `{id, label,
  group, deployed{version, at}, head{version, at}, behind, oldest_unshipped_at, as_of, error}` (`behind` merges on the
  head the deployed version lacks; `oldest_unshipped_at` the oldest of them; `error` when the source could not tell).
  The view's `gaps.deploys[]` adds `state` (`current`, `behind`, `unknown`) and `oldest_s`. A source measures this
  itself (a configured command or file for the deployed version, the repository for the head); the host never asks
  anything.
- **Freshness.** Each source in the view has `freshness[]` `{id, label, age_s, limit_s, state (ok|old|error|disabled), error}`:
  each collector's answer age on the host's clock (`generated_at - as_of`, one clock, plus the time since receipt), its
  limit (`stale_after_s`, else `thresholds.collector_stale_s[id]`) and whether it is too old; every redacted view drops its `error`,
  as it drops the collector's own. A collector the source marks `disabled` has state `disabled`, never `ok`. The page says an old,
  failed or disabled one in the trust line ("atlas-main: tracker answer 14 min old") and in the Crow's nest, and the age of the answer behind
  the waiting number (`waiting.as_of`, `waiting.age_s`) on the call plate itself ("answer 12 min old").
- **Burn rate.** An allowance chip whose account's `runway` says `exhausts_before_reset` with a `projected_empty_at`
  gets `countdown_s`, the seconds until that projected time, and leads with it ("out in 3 h 10 min"); one that is
  `exhausted` gets `back_in_s` until its window resets. Both read the source's own projection against the host clock:
  the host never works out a rate.

Counts (1.2 views): `counts.agent_gone`, `counts.outside` (outside waits) and `counts.queued` (everyone waiting in a
queue). The library (1.10) has its own section, "Library". Redaction: the household view drops `agent.reason` and a deploy's `error`; the guest and public views also
replace outside-wait titles and who, queue holders' labels and coming-up titles of work (machines keep their names), and
the public view drops deploy versions.

## Library (1.10)

A source that mirrors folders of notes into a shared repository (one writer per folder, a sync job on a timer) can say, per folder,
when the job last ran and what it found, so an idle writer and a stopped job do not look the same. Each row is copied from the
receipt the sync job writes on every run; the source adds `id`, `label`, `as_of` (when it read the receipt) and `stale_after_s`. All
fields are optional except `id`; at most 8 rows.

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `label`, `ns`, `repo` | strings | The row's id, its name on the board ("notes/alpha/"), the folder inside the repository, and the repository's name |
| `checked_at`, `finished_at` | times | When the sync run started and ended (the receipt's `run_at` and `finished_at`), the source's own clock |
| `interval_s`, `stale_after_s` | integers | How often the job runs, and how old its last run may get before the board says NOT CHECKED (for example three intervals) |
| `outcome`, `detail`, `failing_since` | string, string, time | How the last run ended, in one word: `pushed` or `nothing_new`, or a failure word (`push_failed`, `fetch_failed`, `merge_conflict`, `scan_hit`, `heal_failed`, `no_clone`, `shrink_refused`, `error`); `detail` the job's own words about it; `failing_since` when the failures began |
| `files`, `changed`, `skipped` | integers | How many files the folder mirrors, how many the last run changed, and how many it left out |
| `head`, `origin_head`, `verified_at` | string, string, time | The local and remote commits after the run, and when the job saw origin hold exactly what it wrote |
| `changed_at`, `changed_sha` | time, string | Origin's newest commit to the folder (its time and short id): the last real change, not the last run |
| `pending` | object | `{files, since}`: files written but not in the repository yet, and the oldest of them. A receipt without it is unknown, never 0 |
| `retired` | boolean | The writer itself says the folder is retired |

The host derives one word per folder (`src/weatherdeck/gaps.py` `mirrors`, pure, every time passed in). The words are a closed set,
each with exactly one rule. The first rule that holds wins, in this order: RETIRED, SILENT, then the receipt's own fields.

| Word | Rule | What the row says |
| --- | --- | --- |
| RETIRED | listed in host config `mirrors.retired` (`{ns, since, note}`), or the row says `retired: true` | the date and the note; never inferred from age |
| SILENT | the source itself is stale or lost (`received_at` against its `interval_s`, the existing rule) | "source silent N"; the row keeps the word it had as last known, its clocks stopped |
| FAILING | `outcome` is a failure word | the outcome in words with `detail`, and since when (`failing_since`) |
| NOT CHECKED | `checked_at`, aged on the host's clock, is older than `stale_after_s` | "sync last ran N ago; the board cannot tell why" |
| WAITING n | a fresh receipt with `pending.files` above 0 | "n files not in the library, oldest since T" |
| UP TO DATE | a fresh receipt, `outcome` `pushed` or `nothing_new`, and `pending.files` exactly 0 | "checked N ago"; with `nothing_new` also "nothing new since" `changed_at` |
| UNKNOWN | anything else: no `checked_at`, no `stale_after_s`, an outcome word this host does not know, no pending count | "the receipt could not be read" |
| NOT REPORTING | a folder listed in host config `mirrors.expected` that no source reports | "no source reports this folder" |

Times in a receipt are the source's own clock; the host moves them to its own by the source's offset (`received_at - generated_at`),
the same way it ages a collector's answer. Fresh means `checked_at` is within `stale_after_s`, so UP TO DATE needs both a live source
and a fresh receipt: "nothing new" is said only from a run whose outcome was `nothing_new`, and old commits alone never make a folder
look healthy or broken. A folder nobody reports is drawn only when the host config names it in `mirrors.expected`; without that the
board says nothing about it (explicit and inert, like `ledger.expected_hosts`). The row is calm: it raises no `attention[]` card in any
state. A source whose receipt is missing, unreadable, of another format or old says so in a collector (for example an adapter's
`mirrors`), so the trust line names it even where no row can be drawn.

The view carries the rows as `gaps.mirrors[]`, worst first (failing, not checked, silent, unknown, not reporting, waiting, up to
date, retired), then by label: `{id, source, machine, ns, label, repo, state, last_known, outcome, detail, pending, nothing_new,
checked_s, limit_s, checked_at, changed_at, changed_sha, failing_since, pending_since, at{checked, changed, failing, pending}, since,
note, as_of}`, where `at` holds host-clock epochs the page counts on and `checked_s` is the run's age when the view was built. The page
reads a source's silence again on its own clock, so a row never reads newer than its source. Redaction: the household view keeps the
folder, the word and the ages and drops `detail` and the retirement `note`; the guest view does the same; the public view has no rows.

## Pace (1.4)

A source that runs on a machine it does not own (a laptop, a build box) may keep itself to a budget and give way when the
machine needs the room. When it does, it says so in `pace`, so the board can say its data is **slower on purpose** instead
of reading the slower reports as silence, or the older answers as fresh. All fields are optional; a source that sends no
`pace` is read exactly as before, and the board says nothing about its pace.

| Field | Type | Notes |
| --- | --- | --- |
| `factor` | number | How far every interval this source keeps is stretched. 1 is normal pace; above 1 the source is **slowed on purpose**. Below 1 cannot be true and reads as 1 |
| `why` | strings | Why it is above 1. The words an adapter may use, for example: `load` (the machine is busy), `battery` (on battery power), `cpu_budget` (the source's own CPU budget for the hour is spent), `run_budget` (its last pass ran past its wall-time budget). An unknown word is shown as sent; none at all is said as "no reason given" |
| `since` | time | When the source began to slow down (only while `factor` is above 1) |
| `pass_s`, `normal_pass_s` | integer | How often the source collects now, and at normal pace |
| `keepalive_s`, `normal_keepalive_s` | integer | The most it now goes without a push, and at normal pace. The envelope's `interval_s` is the first of these, so the page's live, late and silent levels stretch with the pace: a slowed source is on time, not late |
| `load_per_core`, `on_battery` | number, boolean | What the source saw on its machine when it decided. Null when it could not read it (never a made-up 0 or false) |
| `cost` | object | What the source has cost its machine, against its own budgets: `cpu_s_per_h` (CPU seconds, its passes and background refreshers together, over the last hour or what it has measured so far scaled to an hour), `budget_cpu_s_per_h`, `run_s` (wall seconds its last pass took), `budget_run_s`, `over_budget` (either figure past its budget; null while neither is measured) and `measured_s` (how long it has been measuring). A figure that is not measured yet is null, never 0 |

The board's rules:

- A source with `factor` above 1 is **slowed on purpose**, said in the trust line ("atlas-main: slowed on purpose (the
  machine is busy), reports about every 3 min") before any old answers it explains, in the Crow's nest on the reporter's
  row, and with its pace and cost in the reporter's detail. It is never drawn as silent or as late for reporting at the pace
  it declared, and it is never drawn as if it reported at normal pace.
- The levels are the ordinary ones, counted in the declared `interval_s`: a source slowed to a 3-minute keepalive is live
  for 6 minutes, late up to 12, and silent after that. Slowing down therefore delays the board's noticing that a source has
  stopped, in proportion; `pace.factor` is how much. A source that stops reporting is still silent, and silence is still
  said as silence.
- The answers behind the numbers are as old as the pace makes them and are said with their age as before; a collector's
  `stale_after_s` grows with its interval, so a slowed collector is not called stale for being asked less often.
- The host works out none of these figures and never asks the source anything; it shows the source's own words.
- The view's `sources[].pace` is `null` when the source sends none; otherwise `{slowed, factor, why[], since_s, pass_s,
  normal_pass_s, keepalive_s, normal_keepalive_s, load_per_core, on_battery, cost{...}}`, the same fields, with `since_s` counted on
  the host's clock.

## Call as-of (1.8)

`since` on a call is how long it has waited, never how old the answer behind it is. A source that reads its calls from a copy (a cached
snapshot, a summary file) can say which copy: `as_of` on the card is when that copy was made, the source's own time, optional, and left out
when the source does not know it. The page then draws a call as **last known** when the source has a limit for its attention answer
(`collectors[].stale_after_s` of the collector `attention`) and the copy, aged on the host's clock (its age when the source built the feed, plus the
time since the host received it), is older than that limit: "last known, 8 h old; not confirmed", and the waiting-on-you count reads
"at least N" while any call is drawn so. A call with no `as_of`, or from a source with no limit, gets no marker: unknown stays unknown. A
source leaves `as_of` out of what decides a push, because it moves with every refresh of the copy.

**One call, one card.** A call one home relays about another home's task has the id `hold:<owner>/<task>`. When the owner reports its
own feed, the host drops the relaying home's card for that id unless the owner's own feed still lists the same id: an owner that answered
and dropped a call is not overruled by a second-hand copy. When the owner's feed still lists it, the copies merge into one card as before
(more severe first, then the source that sorts first). When the owner is named by something that is no source (a folder name), the
relaying home's card is dropped if a source lists the same call (same kind and task) as its own, and is left as it was sent otherwise.

## Whose turn, dated holds and lanes per machine (1.12)

Five things a board could not say from the fields before: that the viewer has put a call off until a date, that a card is someone else's to
act on, which verdict a held change waits for, how many lanes run on a machine across every home on it, and how old the copy behind a
collector's answer really is. Every field is optional and is filled only from a structured record the source keeps (a hold record with its
bucket and date, a record of whose turn it is, a verdict record, its own lane count, its maker's own stamp), never from the words of a note
or a title. A field the source cannot fill is absent, and the board then reads the card, row or machine exactly as before.

| Field | Type | Notes |
| --- | --- | --- |
| `attention[].actor` | `{role, name}` | Whose turn the card is. `role` is `viewer` (the person reading the board), `supervisor` (the source's supervising agent), `worker` (the lane's own worker) or `external` (someone outside the fleet); `name` is that actor's name as the source calls it ("skipper"). A role this host does not know leaves the card as it was |
| `attention[].hold`, `next[].hold` | `{bucket, until, reason, since}` | A hold the viewer put on it. `bucket` is the source's word for the kind of hold; `dated` is the one this board reads: put off until `until` (a time, or a date that holds through that whole day). `reason` is the holder's own words for why, `since` when the hold was made |
| `attention[].verdict` | `{name, state, as_of}` | The verdict the card waits on before anyone acts: `name` in plain words ("fleet verdict", "Mac verdict"), `state` `pending`, `pass`, `fail` or `unknown` (another word is shown as sent), `as_of` when the source last read it |
| `machines[].lanes` | `{running, total}` | The lanes this source runs on this machine, counted by the source itself: how many are running and how many it has there in all. Only the source's own lanes, never a copy of another home's |
| `items[].lane.branch` | boolean | See "Lane state" |
| `collectors[].made_at`, `collectors[].refresh_s` | time, integer | When the copy the collector read (a summary file, a cached snapshot) was made by its maker, from the maker's own stamp inside the copy and never from the file's modification time; and how often the maker means to remake it. `as_of` stays when the collector read it |

What the host does (`src/weatherdeck/view.py` `aside`, `machine_lanes`; `src/weatherdeck/gaps.py` `freshness`):

- **Set aside.** Each attention card and `next[]` row in the view gets `aside`: `deferred` while its `hold.bucket` is `dated` and its `until`
  has not passed on the host's clock; else, for a card, `theirs` when its `actor.role` is `supervisor`, `worker` or `external`; else null.
  A card set aside is never a call: it is not in `counts.waiting_on_you`, `counts.calls`, the call marks of "since you last looked" or a
  lane's `needs_you`, and a lane it names is not an ask of its own. A critical card stays a problem whatever it says. A hold whose date has
  passed, a hold with no readable date and an unknown role set nothing aside: an ask is never set aside on a guess, and it comes back the
  moment its date passes.
- **Lanes per machine.** A machine's `lanes` in the view is every source's own count for that machine added up: `{running, total, homes[],
  unreported[], or_more}`, where `homes` are the sources that sent one, `unreported` the homes with a lane on that machine in the view that
  sent none, `total` is null when any count lacks it, and `or_more` is true when a count lacks `running` or a home is unreported. A home whose feed is older than `lost_after_s` counts as unreported: its last count is not added. Null when no
  source sends one. The machine row's other fields still come from the one row that wins as before.
- **The copy's age.** A collector with `made_at` is aged from it (`freshness[].made: true`) instead of `as_of`, on one clock as before, so a copy
  that is re-read or re-touched without being remade still grows old; with no `stale_after_s` and no host limit, its limit is twice
  `refresh_s`. `freshness[].refresh_s` carries the maker's interval.
- **Redaction.** The household view drops `hold.reason`; the guest and public views also drop `actor.name` and `verdict.name`. Dates, roles,
  states and the lane counts stay.

What a board says: the cards and rows set aside are listed apart, beside "Needs you", in two groups: **Deferred** (each with its date and
reason, soonest first) and **someone else's turn** (each with whose it is, since when, and the verdict it waits on), never counted. An info
card that is no one else's turn is an FYI and says what kind of notice it is and whose (its `actor`, else "whose it is: not reported"). A source never sends a card, info or otherwise, for an ask whose answer it has on record, because the board cannot tell an answered card from the feed. A
machine says its lanes across every home ("lanes 3 running of 5 · 2 homes", "or more" when a home sent no count). A copy whose made age is
past its limit is a problem, said loudly with its age and its maker's interval. A lane whose state cannot be read now (`lane.state` Can't
tell) but whose `last_word` was `done` or `paused` says what is recorded instead: its PR open ("finished; waiting on upstream review", or "paused; its PR is waiting on upstream review" after `paused`), its PR
merged (worded the same way), a hold on record, or, with no PR and its worker's session ended, "branch only, no worker running" (with `branch: true`) or "no PR is
recorded and no worker is running". "Can't be read" is said only when nothing the lane said is recorded.

## Call options (1.9)

A call that waits on the viewer can list its choices: `attention[].options`, an optional list of at most 4 plain words, each at most 60
characters (a source cuts a longer word and drops a fifth; the host rejects a push over 4 entries like any list over its limit). A source fills it only
from a structured record it already reads (a review board's options for that call, or a decision record that carries a list of them),
never from free text or from a worker's sentence; with no such record the field is absent and the card is the one sentence only. The words
pass the source's usual redaction for card text. The page draws them as read-only chips under the sentence: they are not buttons and do
nothing, because the answer path stays in the source's review board. The `tv` (household), guest and public views drop the field.

## Answer link (1.6)

A call that waits on the viewer (`attention[]` of kind `decision`) can say where it can be answered on the source's own review board, which
is where answering and messaging the agent already work: the board stays read-only and the answer path stays in its one owner. The link
opens the review board where the call is waiting, not the call's own card: the board has no per-card anchors yet, so every call on one board
carries the same board address, and a per-card deep link needs a change in the board template, which is outside this repository. The field
is optional on each card: `answer_link` `{url, label, state, state_as_of, why}`.

- `url`: an `http` or `https` address, present only when `state` is `open`. Never a guess, never an address the source did not read from
  the review tool's own session listing for this home's board file.
- `label`: "review board" when there is a `url`.
- `state`: `open` (the board for this home is open, and this call is on it), `off_board` (the board is open but this call is not on it),
  `none` (no board is open for this home), `ended` (the viewer ended the session), `closed` (a session exists and is not open), `local` (it is
  open but its address only works on the machine it runs on), `missing` (the review tool is not on that machine), `failed` (the review
  tool did not answer: an error or a timeout), `unread` (it printed something the source cannot read), `unchecked` (not asked yet) or `old`
  (the last answer is older than the source's own limit). A state this host does not know is shown as sent, with no link.
- `state_as_of`: when the source last asked (an answer that failed is dated too; `missing` has none). The board says "board link checked N
  min ago" from it, and says the same age beside the reason when there is no link. It moves on every ask, so a source leaves it out of
  what decides a push.
- `why`: one plain sentence for any state but `open` ("no review board is open for this home"), in the source's words.

A source sends a link only when all four hold: the session listed for the board file is `open`, the answer is young enough, the address is
not one that only works on its own machine, and the call's key is one of the keys on that board file. When any fails there is no `url`,
and the card says why; a stale address is never shown. The field is the full profile's: the `tv` (household), guest and public views drop it
(the address names a machine, and a link that answers a call is for the person who may answer it). The page draws it as one plain link on the call, opened
in a new tab; it sends nothing and runs no script. The address is not free text: the source's usual redaction of host names in prose does not
apply to this one field.

## Lane state (1.5)

What each lane is doing, in one fixed word and one plain sentence, so a board can say what the work is doing, what it waits
on, since when and what happened last without anyone reading a worker's own words. Both fields are optional on each item.
**The honesty rule:** a source fills them only from records it keeps itself (a state it reads, a declared wait, a session
record, a recorded blocker, an open question), never from the words of a worker's note: detail words whose origin is not
recorded as the source's own are read as a note, so nothing is read from them; a lane it cannot tell stays
"Can't tell", and a lane whose record is missing gets no `lane` at all (the board then says nothing more than before).

**`lane`**: `{state, cause, since, last_word{verb, at}, short_title, branch}` (`branch` is 1.12).

| Field | Type | Notes |
| --- | --- | --- |
| `state` | string | One of nine words, see the table. An unknown word is shown as sent |
| `cause` | string | A short fixed id (kebab-case) of the rule that chose the state, for example `worker-gone` or `tests-running`. A board words it; it never shows a worker's text. An adapter lists its own ids in its README |
| `since` | time | When the lane entered this state: the time of the record that said it (a declared wait, a session end, the last news) when there is one, else the first time the source saw it in that state. Null when not known (a second-hand copy has none) |
| `last_word` | `{verb, at}` | The newest status verb the worker declared (`working`, `parked`, `needs-decision`, `done`, `blocked`, `paused`, `failed`, `resolved`) and its time. History, never the state: a lane whose state cannot be read shows it with its age. Null when none is recorded |
| `short_title` | string | The job in plain words, cut at a clause break (a semicolon, a dash, a colon, a bracket, a comma) before any word is cut, at most 60 characters. Null when the only title the lane has is its task's own name; the board says "short name only" and never shows the id as a title. Since 1.12 a board shows the item's whole `title` first, wrapped, and uses this only when there is no title |
| `branch` | boolean | 1.12: `true` when the work is on a pushed branch with no pull request, `false` when the source looked and found none; absent when the source does not know. Read only to word a lane whose state cannot be read (see "Whose turn, dated holds and lanes per machine") |

The nine words, in the order a source tries them (the first that matches wins):

| State | The lane |
| --- | --- |
| Waiting on you | has a call open that only the viewer can answer |
| Needs attention | its last run stopped and no pause was declared after it; or its worker's session ended or its endpoint is gone while its work should be moving; or nothing stirred for too long while it runs and no check is running |
| Can't tell | has a state the source cannot read now; its last word and when are said |
| Waiting on the supervisor | is stopped at a gate the supervising agent answers, is blocked, or has an open question for it. The word names the supervisor as the source calls it |
| Waiting on another lane | starts when a lane it has a recorded blocker on lands |
| Paused on purpose | its worker declared a pause (with its end when the declaration gave one), or its last run failed and the worker declared a pause |
| Waiting on a check | has a check running: tests, review fixes or CI |
| Working | has a worker busy at it |
| Finished | its checks passed (the PR is ready or merged) or its report is written |

**`say`**: the one sentence as an ordered list of parts, `{t, ...slots}`. `t` names a template; the board owns the words, the
source only says which template and gives its slots: `step` and `of` (a phase, "2 of 4"), `at` and `until` (times), `how`,
`gate`, `decides` (`supervisor` or `worker`), `findings` and `n` (counts), `more` (how many others), `verb`, and `title` (the
plain title of another lane). A part carries times and numbers, never an age (the board counts from `at`, so the feed does not
change every pass) and never a worker's sentence. A part whose `t` a board has no words for is left out; a slot it does not
know is ignored.

How the view carries it (host, `src/weatherdeck/view.py`): an item's `lane` in the view is the host's own class (see "Lanes on the
board"); the source's is kept beside it as `source_lane`, and `say` is passed as sent. The household view keeps both, and the guest and public
views drop `short_title` and the `title` slot of a part, as they replace titles.

## Goals (1.7)

Which goal each piece of work serves, so a board can read goals first and lanes second. **No backlog has a goal field**, so a source
takes it from a plain text file its owner writes and edits by hand (an adapter documents its own file in its README); a source never
guesses a goal from a worker's words, and work the file does not name simply has none. Everything here is optional.

- **`goal`** on an item, a `next[]` row or a `done[]` row: the goal's name, plain text of at most 60 characters, as its owner wrote
  it. A source that sets any goal leaves the field out of a row no goal names; a board then groups that row under its project (the
  item's `project`, else its `group`) and says no goal is set. It never invents a goal and never files a row under a goal that
  merely resembles its project.
- **`goals[]`**: one header per goal that has at least one row in this feed, in the order its owner listed them (at most 20).
  `{name, lanes, next, done, or_more[]}`: `name` is the same string the rows carry; `lanes`, `next` and `done` count the rows the feed
  carries for it (`items[]`, `next[]` and `done[]` as sent, so after the feed's own limits). A goal with no row has no header: absent
  is not zero. `or_more` lists each of `"lanes"`, `"next"`, `"done"` whose count may be **low** because rows were left out, which
  is any surface `omitted[]` says it capped (a feed limit, a source's own bound such as the landed rows kept per home, landed rows
  with no date). A board then writes the count as "N done, or more" and never as a total.

Reading rules for a board: a count under a goal is a number of rows the board holds, not a total of the goal's work; a count that
`or_more` names says "or more" beside it; and a goal's progress is never drawn as a percentage, since the feed has no total to divide by.

How the view carries it (host, `src/weatherdeck/goals.py`): `items[]`, `next[]` and `done[]` keep their `goal`; the view's `goals[]` is
one header per goal named by any source or any row, in the order the sources name them (newest source first), and a goal two sources
spell alike is one header. Its counts are **recounted over the merged rows the view carries** (a second-hand copy of another source's
lane is one row, not two, so the header never says more than the sources sent; `done` is counted over the view's `done[]`, after its
cut at 30), and a goal no carried row carries has no header: absent is not zero. Its `or_more` is every count any source marked, and
`done` as well when the merged landed rows were more than 30 and the view's `done[]` was cut. A guest or public
view has no `goals[]` and no `goal` on any row, as it replaces titles: a goal's name is its owner's own words.

## The view at a glance (0.3.1)

Nothing new in the feed: this is what the host adds to `/api/view` so a screen can say what changed and group its rows.
The host derives it in `src/weatherdeck/glance.py` (pure, every time passed in); feeds of any 1.x version get it.

- **Grouping.** Every item's `row.order` is `[project rank, machine rank]`: rows group by project first (the row's chip,
  which is `items[].project`, else its group's label; case, hyphens and underscores fold together, work with no project
  last) and by machine second (by the machine's label). The ranks depend on names only, never on states, so a project
  never jumps about as its work moves. `glance.projects[]` lists the groups in that order: `{key, chip, n, off,
  waiting, machines[]}`. The page keeps off-course rows first in its log and sorts every other list by `row.order`.
- **Since you last looked.** `glance.marks` is `{calls[], stuck[], landed[]}`: an opaque 12-hex key (a hash of the
  source and id; never an id or a title) for each call that waits on the viewer (`attention` severity `action`) and
  each lane off course that is not a call (failed, blocked, no agent at it, running long), and the landing times of the
  last week (epoch seconds, at most 2000). A screen keeps its own last look in its browser's storage (`localStorage`
  key `weatherdeck.seen`: the time of the look on the host's clock and the keys of calls and stuck lanes it held) and never
  sends it anywhere. On arrival (the page opens, or its tab comes back) it counts what landed after its last look and
  the keys it did not hold: "Since you looked 3 h ago: 4 landed, 1 new call, 2 newly stuck". Nothing is said on a first
  visit, after an absence shorter than `display.since_last.min_away_min` (10), or when the browser blocks storage.
  Every item's `row.mark` is its lane's key, so the page leaves an old record (Housekeeping) out of "newly stuck".
- **Age in state** is `items[].age` (see "Black holes"); the page counts it on and shows it on every row next to the
  state word, and the oldest wait (the lane longest in waiting or needs action) in the log head.

## The fleet (0.4.0)

Nothing new in the feed: one ship per machine is drawn from `machines[]` and `sources[]` as they are. The host adds
`fleet` to `/api/view`, derived in `src/weatherdeck/fleet.py` (pure; nothing about any tool):

- `fleet.flagship`: the machine in front. `display.fleet.flagship` when it names a known machine, else the machine of
  the source whose `kind` is `primary`, else the first reporting source's machine, else the first machine by name.
- `fleet.order`: every machine id in a fixed order: the flagship, then `display.fleet.order`, then the rest by folded
  label (case, hyphens and underscores folded) and id. State never takes part, so a ship keeps its place.
- `fleet.ships[]` `{id, role, slot}`: the first `fleet.max_ships` (`display.fleet.max_ships`, default and most 6) of
  that order, the flagship (`slot` 0) then the escorts; `fleet.convoy[]`: the ids past them, said as one count.

The page judges each machine on its own clock (as before) and applies the same rules as `fleet.py`:

- **Berth.** `anchored` while the machine is asleep (`display.may_sleep`, quiet in quiet hours); `harbor` when it is
  idle and well (OK, draining, maintenance or reserved, with no lane and no call or critical on it); else `sea`. A
  silent, lost, struggling or alerting machine, or one with an alert unconfirmed, is never moored.
- **Hull word.** One word per machine state, as section 7 of the theme spec: alert, not answering, lost, silent,
  struggling, alert unconfirmed, no word, asleep, draining, maintenance, reserved, OK (worst first); asleep, a declared
  rest and OK read neutral.
- **Convoy.** The count of the ships past the drawn ones and the words of those that are not OK, worst first: "+3 ships
  · 1 alert · 1 silent". The count is always the true total.

- **The roadstead (0.4.1).** `fleet.roadstead` `{open, call}` shares the scene window's width among the ships drawn,
  for the open sea (nothing waits on the viewer: the scene has the whole upper area) and for the narrow window beside a
  call: each `{open, ships[] {slot, x0, x1, scale}, convoy {x0, x1} or null}`, with x as fractions of the window's
  width. The flagship's stretch comes first, then one equal stretch per escort, then the convoy's at the far end; escort
  stretches never overlap one another or the convoy's. `scale` is `full` for the flagship, and for the escorts on the
  open sea with three ships or fewer; else `half`. Only the number of ships and whether a convoy sails decide it, never
  a machine's state.

Redaction: machine ids and labels stay in every profile, as before.

## Versions per machine (1.3, Weatherdeck 0.5.0)

Machines are updated at different times, so the board says which software each one reports from, and flags a gap only
when it changes what that machine can say. Three optional `producer` fields carry it:

| Field | Meaning |
| --- | --- |
| `producer.version` | The **adapter's** version: the mapping from the tool to this feed. Present since 1.0 |
| `producer.pusher` | `{name, version}`: the program that carries the feed to the host, when it is a different thing from the adapter (a relay, a wrapper). An adapter that is also its own pusher sends the same version |
| `producer.host` | The computer's own short name, as it calls itself (not the machine label, which stays `source.machine`). Hidden from every redacted view |
| `producer.meaning[]` | `{since, effect}`, at most 12: what **older** versions of this adapter cannot do. `since` is a version of this adapter; `effect` is one plain sentence about the older ones ("it sends no agent state, so ..."). The newest adapter knows its own history, so an older one needs to carry nothing |

The host (`src/weatherdeck/skew.py`, pure) keeps what each source reported and adds, per source in `/api/view`, `producer`
(`{name, version, pusher {name, version} | null, host}`, every part null when the feed did not say) and `skew[]`:
`{since, effect, newer_version, newer_source}`. Rules:

- **Unknown stays unknown.** A feed with no `producer.version` (or one that is not a plain dotted number) shows "version
  unknown" on the board; it is never guessed, never compared and never the "newer" side. Its source is listed in
  `counts.version_unknown`.
- **Only a gap that changes meaning is flagged.** Sources are compared only with sources reporting the same
  `producer.name`. A source is flagged for a `meaning[]` entry when its version is older than `since` **and** another
  such source already runs a version that has it; the reason is the entry's `effect`. Two machines on different versions
  with no entry in between are not flagged: a different version is not by itself a problem. Flagged sources are listed in
  `counts.version_skew`.
- The page says it in the Machines place (a reporter's row says "older adapter"; opening it gives Adapter, Pusher, Runs
  on and one "Version gap" line per reason), as a chip in the watch strip, as a note in the trust line, and in the
  phone's SOFTWARE section.
- **The received log** (`/api/log`, `weatherdeck received`) carries `adapter` on each line, the version that push reported
  (null when it said none).
- **`GET /healthz`** carries `package`: `{hash, files}`, a short hash over the host's own Python and JSON package files
  (the page's files are already in `version`), so what the host actually runs is readable; `null` when the files cannot
  be read, never a made-up hash.

For a checker that wants the same facts (for example a doctor's version-skew check): read `sources[]` of `/api/view`
(`id`, `machine`, `received_at`, `producer`, `skew[]`) and `/healthz` (`version`, `package`); a source without
`producer.version` is "unknown", not "old".

## How the host merges sources

Applied on every request to `/api/view`.

- **Items:** union of all sources' items. The dedupe key is `(owner, id)`; an id may carry the owner as a `owner/` prefix. When a relayed copy and the owner's own copy both exist, the owner's copy wins while the owner has reported within `thresholds.lost_after_s`; if the owner is lost, or never reports that item, the relayed copy stays and is shown as second-hand. Items never vanish because their owner went quiet. A relayed copy whose owner is named by something that is no source (a folder name) belongs to the one source that reports the same id as its own work, so one lane is never counted twice; that name is then not shown as a missing source.
- **Machines:** union by id, after `machines.aliases` in the host config folds an old id into the machine it is (as one of its stations). A row measured by the machine's own source wins over a probe row from another source; otherwise the newer `as_of` wins. A machine named only by a source or an item still gets a row, marked unknown. When the sources of one machine name two or more `station`s, the machine also carries `stations[]` (`{id, label, sources[], observed_by, status, beat, health, load, mem, pressure, disks, ...}`, each station's newest own row), and its `status` and `pressure` are the worst of them.
- **Attention, next, done, meters, groups:** union by id, with the reporting source recorded (two sources sending the same attention id show one card: the more severe copy, then the source whose id sorts first, so one card never alternates between two sources as they push); counts are recomputed from the merged lists. `counts.off_course` and `counts.lanes_waiting` (1.1 views) count the lane classes above. A call one source relays about another home's task (`hold:<owner>/<task>` or `contrib:<owner>/<task>`) under an owner name that is no source is dropped when the owning source sends the same call as its own; under an owner that is a source, it is dropped when that owner reports and its own feed no longer lists the id (see "One call, one card"). `counts.waiting_on_you` is the page's waiting-on-you number, one per ask: the calls (every card that is neither `critical` nor `info` nor set aside (1.12 `aside`); a critical card is a problem, an info card an FYI and a card set aside is deferred or someone else's turn, none ever counted), plus each lane that says it waits for the viewer's OK (`handoff.state: awaiting_you`) with its PR open (`link.state: open`) and that no call names; the same number on the call band, the Lists header, the Bridge door and the ship plates. A call names a lane when its `item` gives the lane (`<owner>/<id>`, or the bare id from the lane's own source or in a call about the lane's owner, `hold:<owner>/...` or `contrib:<owner>/...`), or, with no `item`, when its `link.url` is the lane's: one ask is one line. Such a lane carries the host's `lane.asks_you: true` (every other item `false`). `waiting_disagree` lists where the calls and the lanes that say they wait report different sets: `{kind, item, item_source, call, call_source}`, kind `lane` for a lane no call names and `call` for a call that names lanes none of which waits on the viewer by any route (`needs_you` as its source sent it, or `awaiting_you` with its PR open or of unreported state) when a named lane comes from another source than the call or reports that it does not wait (`handoff.state` `automatic` or `complete`, or `awaiting_you` with its PR no longer open) (redacted views make `item` and `call` opaque); the page shows a "sources disagree" badge with one line per entry and counts none of it. `counts.calls` is the same count of the call cards alone; `counts.waiting_unverified` lists the sources whose share of it is unverified (see `waiting`).
- **Landed:** `history.landed` is `{mode, since, hours, day_start, n}`. By default it is a rolling 24 hours (`display.landed.window_hours`), so the board never reads "0 landed" just after midnight; with `display.landed.day_start` set (`"05:00"`) it counts since the last time the day started at that hour, and the history chart's days begin then too.
- **Machine alerts are debounced** ([honesty.md](honesty.md)): an `attention[]` card of kind `machine` or `disk` that is not `critical` is raised on the second feed in a row from its source that carries it and cleared on the second in a row that leaves it out, so it can appear, and go, up to one keepalive (`interval_s`) later than the source's own state. A `critical` card, any `service` card (supervision down, a daemon down) and the host's `host:<machine>:lost` card are never debounced. Until confirmed, a card said once is listed in `attention_pending[]` (same fields, plus `source` and `debounce: "raising"`; `counts.attention_pending`), never counted in `counts.attention` or `counts.calls` and never dropped. A pending card's `machine` falls back to its source's machine; pending cards are one per id across sources (the more severe copy, then the source whose id sorts first), and an id already in `attention[]` is not listed pending. A pending card of any severity but `info` makes the page read the machine as ALERT UNCONFIRMED, not OK; a pending `info` card changes the machine's word and berth no more than a confirmed one would. A confirmed card left out of the newest feed stays in `attention[]` with `debounce: "clearing"` for one more feed. A source that stops pushing changes nothing: its alerts stay as last known. The state is kept per source and alert id in the host's history file (`machine_alerts`).
- **History:** derived per source from successive feeds (an item appears, changes state, needs approval, finishes; new `done` entries; `events`), deduplicated by id and a 120 second window. Event text is stored; the verb ("finished", "started") comes from `labels.event_kinds`.

## Offline and degraded semantics

Staleness is computed in the browser, per source, from the host's receive time and the host's clock (the `Date` header), so a dead host cannot hide it.

| Level | Source age | The page |
| --- | --- | --- |
| live | up to `live_within_intervals` (2) intervals | lamp lit |
| late | up to `late_within_intervals` (4) intervals | lamp dimmed, no notice |
| stale | up to `lost_after_s` (900 s) | silent lamp and "X silent 4 min" by the clock; that source's machine reads SILENT, its items keep their state word with LAST KNOWN beside it, their timers frozen |
| lost | beyond that | as stale; when every source is lost the call zone becomes a "Lost contact" notice |
| host down | the page cannot reach its host for `host_down_after_s` | a counting-down hailing plate, the age of the newest data, everything else frozen as last known |

- **A quiet source says what the board knows, in this order of evidence** (every word is a label in `defaults.json`). Late: "Late 1 min (missing after 4 x 20 s)", the age and the stated limit, which is `late_within_intervals` times the interval the feed declares in `interval_s`. Silent: "Silent for 6 min (missing after 4 x 20 s)", then the machine's liveness from its beat, the newest sample any source carries for it (`machines[].beat.age_s`, the view's `beat_seen`): fresh or recent (within `late_within_intervals` of the beat's own `interval_s`) "machine last seen 40 s ago via its beat"; a beat that stopped too "machine not seen for 20 min, its beat is silent too"; no beat ever seen "machine not seen". A source that declares no `interval_s` says "interval not declared" and is never called late or missing (the host's default interval still decides the lamp; the words then say only how long since its last push). Silence alone never reads as down or missing for a machine. The view carries two derived fields for this and no new feed field: a source's `interval_declared` (`true` when the feed declared `interval_s`, `false` when `interval_s` is the host's default standing in) and a machine's `beat_seen` (`{at, interval_s}`, `null` when no beat was ever seen).
- A silent source keeps all its items, machine rows and attention items, drawn as stale. A machine listed in `display.may_sleep` whose reporters went quiet in quiet hours reads "Asleep since 23:41" instead of "Silent" (same grey, same last-known marks); when all reporting sources are such machines, the lost-contact notice says so calmly. It is never dropped and never green. Remove one on purpose with `weatherdeck forget <id>` or `source.retired`.
- A source named in another's `peers[]`, or owning a relayed item, but never seen by this host is a **placeholder**: "X is not reporting" in the Crow's nest and the Sources list. Its relayed items show second-hand. A placeholder is no feed that failed, so the trust line ("4/5 live", "N of M feeds report", the Crow's nest door) leaves it out of the total and does not name it as a problem; the moment this host sees it report it is an ordinary source and is counted like any other, and a source that was seen and then goes quiet is never left out.
- The lamp shows the worst reporting source. "Nothing is waiting on you" is never printed as a present fact while any source that has reported is not reporting; the board says "Nothing was waiting at the last report".
- A rejected push never replaces a source's last good feed; the page shows "update rejected since ...: reason" for that source.

## Transports

All transports end in the same function: validate, check `seq`, store atomically, derive history. See [hosting.md](hosting.md).

- `POST /api/ingest` with a JSON body, `Content-Type: application/json` (anything else is refused with 415) and `Authorization: Bearer <token>`. Tokens are per source and bound to that source's id. A request whose `Host` is not one of this host's names, or whose `Origin` is present and not the host's own, is refused with 403 (see the security note in [hosting.md](hosting.md)).
- `weatherdeck ingest [--source ID]`, one document on stdin (forced-command SSH, or a local pipe). Exit 0 accepted, 65 rejected, 70 internal error.

Responses are short text: `ok seq=N received_at=...`, or `rejected: <reason>` (HTTP 422, or 409 for a replayed `seq`).
