# The tool value ledger: format and reading rule

The contract between a tool that keeps a value ledger and anything that reads it. It is written so that a stranger can
implement a writer for another tool without reading any code: the file, the line, how an unknown is written, the words a
number may be said in, and the rule that turns a window of lines into one reading. The reader in this repository is
`src/weatherdeck/ledger.py`; it implements the "Reading rule" below and nothing else.

The ledger exists because **no tool earns its place unmeasured**. It answers one question per tool, "over the last
fourteen days, did this tool do the one thing it is for, and do we know?", and it answers it from counts that a reviewer
can recompute. It does not say that a tool helped anyone. Nothing in a record says a person acted because of a tool, or
what would have happened without it, so no number here is a saving or a catch (see "Words").

**Version 1.** A line carries `"v": 1`. A reader skips a line of a version it does not know and says so; it never guesses.
Changes within version 1 are additive.

## One file per tool

- One append-only file per tool: `weatherdeck.jsonl`, `infirmary.jsonl`, `lodgings.jsonl`, `seaworthy.jsonl`. UTF-8, one JSON
  object per line, `\n` between lines, no comments. Blank lines are ignored.
- **Aliases.** The reader accepts `doctor`, `harbor` and `preflight` as aliases of `infirmary`, `lodgings` and `seaworthy`. A file
  named `doctor.jsonl`, `harbor.jsonl` or `preflight.jsonl`, and lines whose `tool` is one of those names, read with the same
  counters and the same verbs as the tool they alias. The reader matches a file on the `tool` its lines carry and never maps one
  name to the other, so a line under an alias is not read as the other name's, and no file is renamed. A tool name with no
  profile reads as it always did: its counters are carried, and its reading is UNMEASURED (`no-rule-for-tool`).
- The files live with whoever owns the ledger, **never inside a tool's repository**. They hold counts and record
  references only: no ids, titles, host names or paths from real work. A host is a short alias or an opaque label.
- **Append-only.** A line is never edited or removed. A correction is a new line with `supersedes` naming the earlier
  line's `id`. No running totals are stored: every total is a sum of lines, so a reader can always recompute it.
- Records are per machine, so a writer runs on each machine that holds the tool's records, at least as often as the
  shortest rotation of any source it reads, and the owner collects the lines. A writer never creates a source: a tool
  that has never run on a machine leaves that machine's lines as `no-state-dir`, never zero.
- A reader never raises on a bad file. A line that does not parse, does not validate, or is a duplicate is skipped and
  listed (line number and reason); the rest are used. A torn last line is one such line.

## The line

One line is **one reading of one counter over one closed window on one host.**

```json
{"v":1,"id":"gate_refused@host-a@1791590400","tool":"seaworthy","counter":"gate_refused",
 "host":"host-a","window":{"from":1791590400,"to":1791676800},
 "value":3,"unknown":null,"quality":"exact","combine":"sum",
 "coverage":{"first_at":1791540000,"last_at":1791676700,"rows":41,"covers_window":1.0},
 "src":{"kind":"jsonl","file":"ledger.jsonl","filter":"kind=gate decision=REFUSED",
        "first_ref":"line:212","last_ref":"line:240","digest":"sha256:<64 hex>"},
 "excluded":{"sample":0},
 "read_at":1791677000,"reader":"seaworthy-ledger-writer/1","supersedes":null}
```

(Synthetic values; the shape is the point.)

| Field | Type | Meaning |
| --- | --- | --- |
| `v` | integer | `1`. |
| `id` | string | Unique in the file. Use `<counter>@<host>@<window.from>`, and `#2`, `#3` after it for a correction. A second line with an id already used (and not superseding it) is skipped: the first one wins. |
| `tool` | string | The tool the file belongs to. Every line of one file names the same tool. |
| `counter` | string | The counter's name (the lists below). Lower case, digits and `_`. A name with a retired word ("Words") as one of its `_`-separated parts, such as `minutes_saved`, may only be an unknown (a placeholder): a line that gives it a number is a claim and is skipped as `retired-word-in-counter`. |
| `host` | string | The machine the source was read on: an alias or an opaque label, 1 to 64 characters. |
| `window` | `{from, to}` | Epoch seconds, `from < to`, half open: `from` up to but not including `to`. Closed periods only (a day that has ended); a window still open is never written. Windows of one counter on one host must not overlap. |
| `value` | number or `null` | The count, an integer or a finite number of at least 0. `null` is an unknown and always comes with `unknown`. |
| `unknown` | string or `null` | `null` when `value` is a number; otherwise one of the five reasons below. |
| `quality` | string | How far the number can be trusted (below). Required on every line. |
| `combine` | `"sum"` or `"max"` | How lines of this counter combine across days and hosts. Optional, default `sum`. A 95th-percentile counter is `max`: the worst reading, never a sum. All lines of one counter use one value. |
| `coverage` | object | `first_at`, `last_at` (epoch seconds of the first and last record the source holds, or `null`), `rows` (records in the source for this window, an integer), `covers_window` (a number from 0 to 1: the fraction of the window the source actually covers). |
| `src` | object | Where to look to recompute the number (below). Required on a number; may be `null` on an unknown. |
| `excluded` | object | Rows left out and why, as `{reason: count}`: `sample`, `replay`, `dry_run`. Required on a number, `{}` when nothing was left out. |
| `read_at` | integer | When the writer read the source. |
| `reader` | string | The writer's name and version, for example `lodgings-ledger-writer/1`. (The field keeps the scout's name `reader`: the program that read the tool's records.) |
| `needs` | string (optional) | On an unknown only: the one field that would make the counter measurable, or why none would be honest. Additive within version 1; a reader ignores it. |
| `supersedes` | string or `null` | The `id` of an earlier line this one replaces. The earlier line stops counting; it stays in the file. A name that matches no earlier line is kept and reported as dangling. |

### How unknown is written

An unknown is a line, not a gap. **A counter nobody could read is written as `value: null` with its reason**, so its
absence is visible and is never mistaken for a quiet day.

| `unknown` | Meaning |
| --- | --- |
| `no-state-dir` | The tool has never run on this host: its state directory does not exist. |
| `field-absent` | The tool does not record this yet. The counter will stay unknown until it does. |
| `source-truncated` | The source starts after the window does, or rows may have rotated away, and a number would be a guess. (When the rows seen are a true floor, write the number with `quality: "lower-bound"` instead.) |
| `source-unreadable` | The source exists but could not be read (permissions, corruption, a lock). |
| `not-measurable` | Not measurable by design. Written once so the absence is visible: for example the number of times a board was looked at, or minutes saved. |

**The number `0` is allowed only when `coverage.covers_window` is `1.0` and the source was present.** Anything less is a
lower bound of 0 and must be written as `null` with its reason, or the reader skips the line. Absent is never zero.

### Quality

| `quality` | Meaning |
| --- | --- |
| `exact` | Every row of the window was seen. |
| `lower-bound` | The source starts after the window, a switch that disables the record was off, or rows may be lost. The true number is at least this. |
| `rebuilt` | Derived from other records, not recorded as an event (a silence episode rebuilt from gaps between pushes). |
| `estimate` | Uses a rate or a median (an estimated cost). |
| `labelled-offline` | A hand label, such as a one-day accuracy study. Never mixed with runtime counters: a reader leaves it out of every sum. |

### Coverage

`coverage` is how rotation and trimming show up instead of reading as a quiet day. A source that keeps only the last
megabyte of a log and is read daily covers the day only if its first record is older than the window start. A writer
sets `covers_window` to the fraction of the window between the source's first and last record that the source can speak
for, and never above what it saw. A day with no line at all is **not** a covered day: the reader counts a missing day as
no coverage, never as zero events.

### The source: how a number can be recomputed

`src` names the exact rows counted:

- `kind`: `jsonl`, `log`, `table` or `api`.
- `file`: a bare file or table name, never a path (a name with `/` or `\` is skipped).
- `filter`: the condition that picked the rows, in words or a simple `field=value` form.
- `first_ref`, `last_ref`: the first and last counted record (`line:212`, a row id, a timestamp). Both `null` only when
  the counted set is empty.
- `digest`: `sha256:` and 64 lower-case hex digits of the exact source rows counted. For a line file, the bytes of each
  counted line without its newline, joined with `\n`, in file order, with no trailing newline. For a table or an API, one
  canonical line per row, serialised the way `src.canon` says (a short sentence such as "compact JSON object, keys
  sorted"); say it. An empty counted set digests the empty input. A reviewer who re-runs the filter gets the same digest
  or finds that the source changed.

A number with no `src`, with a digest that is not in that form, or with no `excluded`, is skipped by the reader. A number
is only as good as the ability to recount it.

## Counters

Each tool writes only the counters it can honestly read. A counter it cannot read is written as an unknown, once a day,
with its reason. Counters marked ◆ are the ones a reading rule needs (the "value event", below).

| File | Counters (v1) |
| --- | --- |
| `weatherdeck.jsonl` | `pushes_ok`, `pushes_rejected`, `feeds_missed` (sum of gaps), `calls_raised`, `landed`, `restarts`, `silence_episodes` (`rebuilt`), ◆`surfaced_cleared` (host-derived conditions that cleared; `field-absent` until the host records its own transitions). `views` is written as `value: null, unknown: "not-measurable"` so its absence is visible; so is `caught`, in version 1 only (deprecated, see below). The host's own writer (`src/weatherdeck/ledgerwriter.py`) adds `surfaced_failed` (events recorded in a source's own word `failed`), `pushes_ok_<key>` (accepted pushes of one source, `<key>` an opaque 12-digit key, never its id) and `events_missed` (`not-measurable`), and writes no `caught` at all. |
| `infirmary.jsonl` (accepted as `doctor.jsonl`) | `explain_verdicts` (by verdict), `finding_episodes` (by catalogue id), ◆`repairs_verified`, `repairs_failed`, `repairs_refused`, `took_ms_p95` (`combine: max`), ◆`judged_real`, `judged_wrong` (both `field-absent` until a judgement is recorded). |
| `lodgings.jsonl` (accepted as `harbor.jsonl`) | `jobs_finished`, `jobs_placed_elsewhere`, `queued_s_sum`, `jobs_waited_60s`, ◆`gate_refused`, `gate_unchecked`, `passport_exported`, `passport_imported`, ◆`passport_confirmed`, `passport_refused`, `drain_transitions` (`rebuilt`), `drain_requests` and `offers` and `offers_moved` (`field-absent` until recorded), ◆`drains_completed` (`field-absent` until a drain records its end), `minutes_saved` (`not-measurable`; deprecated, see below). |
| `seaworthy.jsonl` (accepted as `preflight.jsonl`) | `pass_receipts`, `hosted_runs`, `hosted_minutes`, `est_cost` (`estimate`), `overrides`, `gate_refused`, `gate_go`, ◆`refusals_stood` (refusals with no override and no later green hosted run at the same revision; `field-absent` until every gate decision is recorded), `minutes_not_dispatched_upper` (an upper bound, `field-absent` until then). |

What each of these tools writes, so a profile is never read as a measurement:

- **Lodgings** writes `lodgings.jsonl` (`"tool": "lodgings"`) with `jobs_placed`, `placements_fell_back`, `jobs_finished`, `queued_s_sum`,
  `jobs_waited_60s`, `gate_refused`, `gate_unchecked`, `gate_checked`, `drain_transitions` and `drain_requests`, and writes
  `jobs_placed_elsewhere`, `offers`, `offers_moved` and `drains_completed` as unknowns and `placement_minutes_vs_local` as `not-measurable`.
  It writes no `passport_*` counter yet, so `passport_confirmed` reads as no reading (a value event that is not recorded is never zero).
  Counters in that list that this table does not name are carried and counted, and take no part in a reading rule.
- **Infirmary** writes its own `incidents.jsonl` and `judged.jsonl` (lines with `"tool": "infirmary"`, which are not value-ledger lines),
  from which a ledger owner's writer can derive `explain_verdicts`, `judged_real` and `judged_wrong`. It writes no `infirmary.jsonl` itself.
- **Seaworthy** keeps its own unrelated `ledger.jsonl` (its budget and gate record) and writes no value-ledger lines. It has a
  reading profile so a ledger written for it by a ledger owner's writer would read; today there is none, and it reads as
  `no-ledger`, UNMEASURED.

A new tool writes a file of its own under the same line, picks counter names that say what the record shows, names one or
more value-event counters, and proposes its thresholds (the defaults below apply if it does not). A counter name
that is not in this table is carried and counted by a reader, takes no part in a reading rule, and is shown on a board
without its name.

**Deprecated v1 names.** `caught` (`weatherdeck.jsonl`) and `minutes_saved` (`lodgings.jsonl`) use a retired word ("Words") and
are dropped in the next version of this format. In version 1 a reader accepts them only as placeholders (`value: null`
with a reason) and never shows their names; a number under either, or under any name with a retired word, is refused as a
claim. A writer that wants to say what its tool did uses the counters named in the honest verbs instead: `surfaced_cleared`
for what the board **surfaced**, `gate_refused` and `refusals_stood` for what was **refused**, `jobs_placed_elsewhere` for
what was **placed**, `landed` for what **landed**, and `minutes_not_dispatched_upper` for what was **not dispatched (upper
bound)**. A new counter name never uses a retired word.

## Words

A number is said in the record's own verb, because the record shows an act and nothing more.

| Say | When the record shows |
| --- | --- |
| **surfaced** | The board or the tool showed a condition (a call raised, a lane off course, a source silent). |
| **refused** | A gate or a repair declined to act. |
| **placed** | A job ran on a host. Placement activity, not proof that placement beat running locally. |
| **landed** | Work finished and was reported as done. |
| **not dispatched (upper bound)** | A run that a refusal stopped from being sent, summed from its worst-case timeout. Always an upper bound, never a saving. |

A tool may also use the plain verb of an act its own record shows (repaired and verified, moved, explained), provided the
record shows exactly that act.

**Retired: "caught", "saved" and their near synonyms ("prevented", "avoided", "averted", "spared", "rescued").** Used as
a claim ("caught 3 stalls", "saved 40 minutes", "prevented a bad release") they say that a person acted because of the
tool or that something worse would otherwise have happened. No record anywhere holds either, so no surface of this
project says them as a claim until a field records exactly that. A surface that wants to say what a tool did uses the
verbs above. Where a number cannot be said in them it is not said: no value number is shown until it is measured.

## Reading rule

All thresholds below are **documented defaults**, numbers in the reader's configuration (`RULE` in
`src/weatherdeck/ledger.py`), and each can be tuned without changing the rule. They are proposals, not measurements.

**Window.** A reading period is **14 days**, closed days only. A window ends at the `to` the caller supplies (the end of
the last closed day); a reader never reads a clock. A line belongs to a window when its own window lies wholly inside
it. A line that straddles the edge is not counted and is reported.

**Per counter, over a window.**

- *Hosts* are every host that has any usable line of the tool in the window, plus any the caller says to expect. A host
  that never wrote is invisible; the caller names it, or it is not counted.
- *Value*: the sum of the numeric lines (or their maximum, for `combine: max`), across days and hosts. Superseded lines,
  skipped lines and `labelled-offline` lines are left out. If no line carries a number, the value is unknown, with the
  reasons the lines gave, or `no-reading` when there is no line at all, or `conflict` when lines of one host overlap or
  disagree on `combine`.
- *Coverage*: over every host, the seconds of the window that numeric lines cover, each weighted by its
  `covers_window`, divided by hosts times the window length. A missing day, an unknown line and a conflict count for
  nothing. Coverage is a number from 0 to 1, never rounded up.
- *Status*: **covered** at 0.9 or more; **partial** from 0.5 up to 0.9; **blind** below 0.5, or when the value is unknown.
- *Quality of the sum*: `lower-bound` if coverage is under 1 or any line says so; otherwise `estimate` if any line does;
  otherwise `rebuilt`; otherwise `exact`.

**Value event per tool.** The one thing a tool must produce to count as earning its place, each a thing a record can
show. A tool's value events are the sum of its value-event counters (◆ above).

| Tool | Value event | Counters |
| --- | --- | --- |
| Weatherdeck | A condition the board derived and no source pushed (off course, silent, lost) that later cleared | `surfaced_cleared` |
| Infirmary | A repair verified, or a finding judged real | `repairs_verified`, `judged_real` |
| Lodgings | A gate refusal, a completed passport move, or a drain that ended with its jobs finished in place | `gate_refused`, `passport_confirmed`, `drains_completed` |
| Seaworthy | A refusal that stood: not overridden and not followed by a green hosted run at the same revision | `refusals_stood` |

**Readings.** One per tool per window.

| Reading | Meaning |
| --- | --- |
| **UNMEASURED** | No keep or cut call can be made: a value-event counter is blind or its field is absent, and no covered counter shows an event. Opens the slice that adds the field. Blocks any public claim. |
| **KEEP** | At least one value event was recorded in a covered or partial counter, and no cut condition holds. Eligible to be cited (below). |
| **QUIET** | Every value-event counter is covered, and none shows an event. Not a cut by itself: a guard that never fires may be healthy. |
| **CUT-CANDIDATE** | Cut conditions, each of which needs covered counters: `quiet_windows_for_cut` consecutive windows (default **2**) that all read QUIET; or judged-wrong share above **30 %** of judged (`judged_wrong / (judged_real + judged_wrong)`, Infirmary); or override share above **50 %** of refusals (`overrides / gate_refused`, Seaworthy: the gate trains people to bypass it); or a declared cost counter over its declared budget with no value event. The reading proposes a review and lists the evidence; a person decides. |

Order of evaluation: a cut condition by share or cost first, then KEEP, then QUIET (then CUT-CANDIDATE if the
`quiet_windows_for_cut` − 1 windows before it were QUIET too), then UNMEASURED. **A partial or blind counter can never support a CUT-CANDIDATE:** a tool is never
cut on a number that may be missing rows. A partial counter with events reads KEEP with `lower_bound` set, and is not
citable. A tool with a cost clause names its cost counter and its budget in the rule; none is declared by default, so
that clause is not evaluated until a tool declares one.

**The previous window.** The consecutive-windows rule needs the windows before the window too (with the default of two,
the fourteen days before it); the reader evaluates them and reports the reading of the one just before as `previous`
beside the reading.

**Citing a number outside.** Nothing is published by this repository. When the question arises, a number about a tool may
appear in public material only if all hold. The reader decides the first four and reports which fail (`cannot_cite`); the
last three are for the person.

1. Its reading is **KEEP** and every counter that supports it is **covered**.
2. The window is 14 days or longer and, where the tool's lines name two or more hosts, at least two contributed numbers.
3. The number has no `null`, no `lower-bound` and no `estimate` inside it; otherwise it must be stated as exactly that
   ("at least", "estimated at").
4. It is said in the record's verb ("Words"), never "caught" or "saved".
5. Sample, replay and demo rows are excluded and the count of excluded rows is on file (`excluded`).
6. Only counts are shown: no ids, titles, host names or paths.
7. A reviewer can re-run each cited `src.filter` and reproduce the `digest`.

A tool whose window reads UNMEASURED may still be published as software, only without a value claim.

## Reading it

```python
from weatherdeck import ledger

r = ledger.read("infirmary.jsonl", to=1791676800, expected_hosts=["host-a", "host-b"])   # "doctor.jsonl" reads the same
r["verdict"]["reading"]            # "KEEP", "QUIET", "CUT-CANDIDATE" or "UNMEASURED"
r["counters"]["repairs_verified"]  # value or None with `unknown`, `coverage`, `status`, `quality`
```

`ledger.read(path, to, ...)` opens the one path it is given and does nothing else: it writes nothing, creates nothing,
and does not look at the clock. A missing file reads as every counter unknown (`no-ledger`) and the reading UNMEASURED.
The result keeps every skipped line (`file.skipped`) so a bad line never disappears quietly.

## What this does not do

It does not count views, and it does not measure whether anyone acted on what a tool showed: no record holds either, so
those counters are `not-measurable`. It does not read a tool's own records (each writer does that, on its own machine).
It does not write a ledger, change a feed, or run unless asked: the board's ledger cards ([ADDINS.md](ADDINS.md), "Ledger cards") are off by default and only show what this reader returns. The one writer in this repository is the host's own, for `weatherdeck.jsonl` ([ADDINS.md](ADDINS.md), "Writing the ledger"): it is off by default too.
