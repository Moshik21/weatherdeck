# The honesty contract

One page for anyone who reads the board, feeds it, or writes an adapter. The board is read-only and deterministic: it
says only what a source reported, and when it cannot say something it says that instead. An adapter that feeds the board
agrees to these rules; the host enforces the ones it can.

## What the board will not do

1. **Never green when silent.** A source that stops reporting stays on screen, grey, fogged and labelled with how long
   it has been quiet. Its machine reads SILENT or LOST, never OK, and a silent machine never moors in the harbor.
2. **Last known keeps its state word.** Work from a silent source keeps what it last said, with LAST KNOWN beside it and
   its clock stopped. Nothing is dropped and nothing is guessed forward.
3. **Unknown and stale are shown, never zero.** No word is NO WORD, an unreported version is "version unknown", an
   unverified count says it is unverified, a missing reading is left out and not drawn as 0. A zero on the board is a
   source saying zero.
4. **Ranges, not bars.** Progress is an honest percent range, or a phase ("2 of 4") when the source knows the phase and
   not a percent. Nothing moves inside a step.
5. **Counts come from unbounded totals.** A list that is cut says "+N more" (`omitted[]`); the number beside it is the
   true total.
6. **The scene says nothing the plates do not.** The ship, weather, lights and creatures are mood drawn from the same
   fields as the words. Nothing is said only by the picture.
7. **Never fake an event.** A creature appears only when its field changes in a real feed. The replay key plays the
   newest real event again, said as a replay, and never makes one up. Demo data says "Demo data" on screen.
8. **A machine alert needs two feeds to raise and two to clear** (below).

## Every number, creature and light maps to one real feed field

| On the board | The one feed field it reads |
| --- | --- |
| A ship per machine, its place in the fleet | `machines[]`, `source.machine` |
| WAIT ON YOU, the amber plate | non-critical `attention[]` cards with `severity: action`, plus each item the host marks `lane.asks_you` |
| The bar's takeover, storm weather, the red edge | `attention[]` with `severity: critical` |
| A machine's word (OK, STRUGGLING, NOT ANSWERING) and its weather | `machines[].status`, `load`, `mem`, `disks`, `pressure` |
| A machine reading SILENT, fog over it, gulls leaving it | a source's last report time (`received_at`) against its own `interval_s` |
| A machine reading LOST | `machines[].beat` stopping |
| ASLEEP, RESERVED, MAINTENANCE, DRAINING | `display.may_sleep` with quiet hours, and `machines[].health` |
| Sailors and where they stand | `items[].state`, `phase`, `progress.current.step` |
| Slack sails | `items[].progress.current.activity` |
| A longboat, dolphins | `done[]` |
| A whale | `groups[].checkpoint.live.version` |
| A rainbow | `attention[].severity` clearing from `critical` |
| An island on the far horizon, its mist or beacon, dotted or fogged | `next[]` (`kind`, `until`, order), the queue collector's freshness and its source's silence; none when `next[]` is empty |
| A stern window, lit, dark or shuttered | `items[].agent.state`; shuttered when none is reported or the report is old |
| A goal header and the count under it ("5 done, or more") | the view's `goals[]`: `goal` on `items[]`, `next[]`, `done[]`, and `or_more`, which says a count may be low; a row with no `goal` is grouped by its project and says so |
| Allowance chips | `meters.accounts[]`, with their reset times |
| A Library row per mirrored folder: its word (UP TO DATE, WAITING n, FAILING, NOT CHECKED, SILENT, UNKNOWN, NOT REPORTING, RETIRED) and "checked N ago", "last change N ago" | `mirrors[]` (`checked_at`, `outcome`, `pending`, `changed_at`, `stale_after_s`) and its source's `received_at`; NOT REPORTING and RETIRED only from the host config's `mirrors.expected` and `mirrors.retired` (or the row's own `retired`). No attention card in any state |
| Adapter, pusher and host version | `producer.version`, `producer.pusher`, `producer.host` |
| The lighthouse | whether the page can reach its own host (`GET /api/view`) |

## Measured, derived or unknown

Each number on the board is one of three things, and the board says which when it can.

| Number | Kind | What stands behind it |
| --- | --- | --- |
| A machine's load, memory, swap, disk free, battery | **Measured** by the source on that machine | The value in its last report, as old as that report |
| A percent range on a lane, a lane's state and phase | **Measured** (reported) by the source | `items[].reported`, `state`, `phase`; the board shows it as a range and never invents a finer one |
| Allowance percent left and reset time | **Measured** (reported) by the source | `meters.accounts[]`; a "lasts through reset" or burn-rate line is **derived** from them |
| Adapter, pusher and host version | **Measured** (reported) by the source | `producer`; "version unknown" when it said nothing |
| WAIT ON YOU, under way, off course, waiting, landed | **Derived** by the host | A count of `attention[]` and `items[]` under the lane rules in [feed-spec.md](feed-spec.md); the "+N more" total is the true total |
| STRUGGLING | **Derived** by the host | A machine's load against its own slow-moving norm, never against a fixed bar |
| SILENT 16 MIN, an item's age in state, the oldest wait | **Derived** | The host's receive time (or the item's own time) against the clock; frozen at last known while the source is silent |
| A machine alert, once confirmed | **Derived** by the host | Two consecutive feeds (below) |
| Anything a source did not send, or sent as unknown | **Unknown** | Shown as NO WORD, "unknown", "version unknown" or "unverified"; never as 0, never as OK |

**What the board can know:** only what a source reported, when the host received it, and how long ago that was. **What it
cannot know:** whether a source is right, whether work it never reported exists, why a source went quiet (a sleeping
laptop, a dead network and a crashed pusher look the same), or anything that happened between two reports. A source that
reports a wrong number shows a wrong number, with its age.

**What it never claims:** that a machine or a lane is fine because nothing was heard; that a count is complete when a
list was cut; that a value is current when it is last known; that an alert is real before the second feed, or gone before
the second feed; a cause it was not given; or any event, creature or light without a real feed field behind it. It makes no
model or LLM call anywhere: every word and number on the board is arithmetic on feed fields.

The same mapping is kept in the page's key (`web/world.js`), and the feed fields are defined in
[feed-spec.md](feed-spec.md).

## No value number until it is measured

The board counts what a record shows and nothing about whether it helped. **No number about a tool's value is shown, in
the page, the docs or the changelog, until it is measured** under the reading rule in [ledger-spec.md](ledger-spec.md):
a fourteen-day window, enough coverage, every number carrying the range and digest of the rows it was counted from.
Until then a tool's value reads UNMEASURED, and says so.

Two words are retired as claims, with their near synonyms ("prevented", "avoided", "averted", "spared", "rescued"):
**caught** and **saved**. Nothing in any record says that a person acted because of a tool, or what would have happened
without it, so "caught 3 stalls" and "saved 40 minutes" would be invented counterfactuals. Where the board or a doc
says what a tool did, it uses the verb the record supports:

| Say | The record shows |
| --- | --- |
| **surfaced** | the board showed a condition |
| **refused** | a gate or a repair declined to act |
| **placed** | a job ran on a host |
| **landed** | work finished and was reported done |
| **not dispatched (upper bound)** | a run a refusal stopped, summed from its worst-case timeout |

### What the ledger cards claim, and do not

The board can draw one card per tool from its ledger ([ADDINS.md](ADDINS.md), "Ledger cards"). They are **off unless the
config asks** (`ledger.enabled`), and they add no process and no new read beyond one small file per tool.

A card claims only this:

- the **reading** the rule in [ledger-spec.md](ledger-spec.md) gives for the last 14 closed days: keep, quiet,
  cut-candidate or unmeasured, in those words, with the window it covers;
- per counter, **a number only when it is covered and exact**; otherwise "unknown" with the reason, "at least N" with its
  coverage, or the number withheld when the counter is blind. Coverage is rounded down, never up;
- the record's own verb for what was counted (refused, moved, repaired and verified, judged real, surfaced). A counter is
  labelled only with a name the spec lists; any other is shown as "other counter, not in vocabulary", so a writer's own
  counter name cannot bring a retired word back. A placeholder under a deprecated retired-word name (`caught`,
  `minutes_saved`) is only counted as "not measured", never named, and a line that gives such a name a number makes the
  card "Ledger not valid".

The host's own writer ([ADDINS.md](ADDINS.md), "Writing the ledger") counts rows it already keeps, in the record's verbs
(surfaced, landed), and leaves what it cannot count as unknown with the one field that would make it countable: the
conditions the board derives itself (`surfaced_cleared`), views and missed events, and any day with no push at all.

A card does not claim:

- **that a tool helped anyone.** No record says a person acted because of it, so there is no "caught", no "saved" and no
  minutes or money. `OK` on a ledger card means nothing needs doing, not that the tool has proved its worth;
- **that a quiet tool is useless.** A quiet window is not a cut; a cut candidate is a review for a person, never an
  action, and never rests on a counter that may be missing rows;
- **a zero for a missing or unreadable ledger.** That reads "No ledger yet", with no numbers at all. Neither does a counter
  nobody could read: it says why;
- **anything about a host that wrote nothing**, unless the config names it in `ledger.expected_hosts`;
- **that a number may be cited outside.** That is the spec's seven conditions, decided by a person.

Counters that cannot be measured, such as how often a board was looked at, are written down as `not-measurable` so the
absence is visible; they are never drawn as zero. The words come back only when a field records exactly the act they
name.

## The debounce: two feeds to raise, two to clear

A machine alert is an `attention[]` card of kind `machine` or `disk` that is not `critical`. A single feed that says it
is not enough: the host raises it on the second feed in a row that carries it, and clears it on the second in a row that
leaves it out. A card seen once and then gone never becomes an alert. This keeps a machine from flapping on one odd
sample.

What it costs: **a machine alert can appear up to one keepalive later, and go one keepalive later, than the source's own
state.** A keepalive is the source's push interval (`interval_s`, 30 s unless the source says otherwise). The board takes
that delay on purpose and says so here.

What it never does:

- **It never delays a critical, or a supervision or service card.** A `critical` card, any `service` card (supervision
  not beating, pipeline daemon down) and the host's own "machine is lost" card go straight through, in both directions.
- **It never reads as healthy while it waits.** An alert said once is shown as pending: its row sits in the machine's
  deck, marked unconfirmed, and it is not counted in WAIT ON YOU. When the card is one that would change the machine's
  state once confirmed (any severity but `info`), the machine's word reads ALERT UNCONFIRMED (never OK), it does not moor
  in the harbor, and a convoy plate counts it as "alert unconfirmed". A pending `info` card (a low disk, say) changes none
  of these, because a confirmed `info` card does not either: the debounce never makes a machine flap. A card that names
  no machine is held against its source's machine. One alert sent by two sources is one row, and a pending copy of an
  alert already confirmed is not listed again. An alert already confirmed that has been left out once stays listed until the second
  feed.
- **It never hides silence.** The debounce only counts feeds that arrive. A source that stops reporting freezes its
  state at last known and fogs, as rule 1 says; it does not clear its alerts.

The debounce is in `src/weatherdeck/debounce.py`; its state is one row per source and alert in the host's history file.
