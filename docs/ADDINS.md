# Add-in cards: `lookout.card` 1.0

A **card** is one small JSON file a tool leaves for the board: who it is, a status, one headline, a few labelled numbers,
when it was written. The board loads every valid card it finds in one directory and draws a tile for each. That is the whole
mechanism.

- **Read-only data.** The board never imports, runs, installs or even looks for a tool. It reads `*.json` files, parses them
  with the standard library's JSON reader, and checks them against [the schema](../src/weatherdeck/card.schema.json).
- **Explicit and inert.** No directory, no cards, no tiles. A tool that wrote no card has no tile, and nothing says "missing".
- **No network.** A card's `link` is shown as text; the board fetches nothing a card names, and a tool needs no network
  to write a card. (Cards are not a second ingest endpoint: `/api/ingest` takes feeds only.)
- **Each tool stays standalone.** A tool writes a card through its own optional command. It does not import Weatherdeck, and
  Weatherdeck does not import it.
- **Not a plugin framework.** No registry, no card types, no scripting, no templates. Cards do not raise alerts, play
  sounds, or enter the history.

Use a **feed** ([feed-spec.md](feed-spec.md)) when a tool reports work items, machines or things that wait on a person. Use a
**card** when it has one thing to say about itself.

## The card

```json
{
  "schema": "lookout.card",
  "schema_version": "1.0",
  "tool": "site-doctor",
  "title": "Site Doctor",
  "status": "warn",
  "headline": "2 findings, 1 repair plan waits for you",
  "numbers": [
    { "label": "findings", "value": 2 },
    { "label": "plans waiting", "value": 1 },
    { "label": "last check", "value": 42, "unit": "s ago" }
  ],
  "link": "https://example.invalid/runbook",
  "updated_at": "2026-01-01T09:00:00Z",
  "mode": "advice-only",
  "stale_after_s": 600
}
```

| Field | Rule |
| --- | --- |
| `schema`, `schema_version` | `lookout.card` and `MAJOR.MINOR`. Any `1.x` is read; a higher major is rejected with a reason |
| `tool` | Required. Stable id, `[a-z0-9][a-z0-9._-]{0,47}`. One card per tool: of two files with the same `tool`, the newer `updated_at` wins |
| `title` | Required, 1-60 characters |
| `status` | Required: `ok`, `warn`, `bad` or `unknown`. Nothing else: a word the board cannot place is rejected, not guessed |
| `headline` | Required, one line, 1-160 characters |
| `numbers` | Optional, at most 6 of `{label (1-32), value (number or string up to 32 characters), unit (optional, up to 12)}` |
| `link` | Optional `http(s)` URL, shown as text |
| `updated_at` | Required, RFC 3339 UTC ending in `Z`. More than 5 minutes in the future is rejected (a wrong clock would hide staleness) |
| `mode` | Optional short word, `[a-z][a-z0-9-]{0,23}`: how the tool is running. A repair tool says `advice-only` or `live-repair`; the board shows it beside the status and does not interpret it |
| `stale_after_s` | Optional integer, 60-604800. How long after `updated_at` the card may be called current. Default: `cards.stale_after_s` (900) |

Unknown fields are ignored, so 1.x can grow. A card file is at most 16 KiB. The shape above is checked from one file,
`src/weatherdeck/card.schema.json` (JSON Schema 2020-12); `weatherdeck card validate` reads that file, so they cannot disagree. Three
rules a schema cannot say are in code: the time must be a real calendar time, not in the future, and the major version must be 1.

## What the board does with cards

| Situation | Result |
| --- | --- |
| No card directory, or no `*.json` in it | Nothing is drawn |
| A valid, recent card | A tile: status glyph and word, title, `mode` |
| `now - updated_at` greater than the card's window | **Stale**: the tile turns grey and reads `STALE 50 min`; the phone says `last status: Bad`. An old card never reads OK. Staleness is decided in the page from the host's clock, as for sources |
| An invalid file | Not drawn. Logged once as `weatherdeck.cards: card file X rejected: <reason>` in `server.log`, counted on the phone ("1 card files rejected"), listed by `weatherdeck card list` |
| Two files, same `tool` | The newer one is drawn; the other is reported as superseded |
| More than `cards.max` (24) | The most urgent are drawn; the rest are reported |
| A symlink, a non-file, a file over 16 KiB, a `.tmp` or hidden file | Skipped or rejected; never followed |

Where they appear: on the TV board, **Tools** is the last row of the work log, one chip per card, worst first (bad, warn, stale,
unknown, ok); the mode is shown when the row has room. On the phone, a **Tools** section lists every card with headline,
numbers, mode and link. A status is always a glyph and a word, never colour alone.

Profiles: the full view shows everything. The `tv` (household) view shows only title, status word, mode and staleness, because
headlines, numbers and links are free text a tool wrote. The guest view shows the same without the title (the tool's name stands in). The `public` view, and the `tv` view while privacy mode is on, show no cards.
The host removes them before the view is cached.

## Ledger cards (off unless asked)

A board can also draw one card per tool from that tool's **value ledger** ([ledger-spec.md](ledger-spec.md)). It is the same
card, drawn the same way (a chip on the TV, a section on the phone), and it is **off by default**: with `ledger.enabled`
unset or false the board does not look for a ledger at all. No new process starts and nothing is fetched. The cards only
read; the host's own writer for the Weatherdeck ledger is separate and off too ([Writing the ledger](#writing-the-ledger-off-unless-asked)).

```json
{ "ledger": { "enabled": true, "dir": "/path/to/ledgers", "tools": ["infirmary", "seaworthy"], "expected_hosts": ["host-a"] } }
```

| Key | Meaning |
| --- | --- |
| `ledger.enabled` | `false` by default. `true` draws one card per tool in `tools` |
| `ledger.dir` | Where `<tool>.jsonl` files are, default `<data dir>/ledger`. The files belong to whoever owns the ledger; copy or mount them here |
| `ledger.tools` | Which tools get a card (default `weatherdeck`, `infirmary`, `lodgings`, `seaworthy`; `doctor`, `harbor` and `preflight` are accepted as aliases of `infirmary`, `lodgings` and `seaworthy` and read the same profile; at most 8, names `[a-z0-9_-]`). A tool listed here whose file is missing still gets a card, saying so |
| `ledger.expected_hosts` | Hosts the reader should count as expected even if they wrote no line (a host that never wrote is otherwise invisible, see the spec's "Reading rule") |
| `ledger.max_kb` | A file larger than this (default 8192) is not read, and its card says so |

**What a card says.** Title `<Tool> ledger`, tool id `ledger-<tool>`. The `mode` is the reading in the spec's words (`keep`,
`quiet`, `cut-candidate`, `unmeasured`) and the headline says it in plain words with the window (14 days, closed UTC days):

| Reading | Status | Headline |
| --- | --- | --- |
| KEEP | `ok` | "Keep: 3 refused, 1 moved in 14 days to 2026-10-09." (the record's own verbs; "(at least: not fully covered)" when a counter is only partly covered) |
| QUIET | `ok` | "Quiet: no value event in 14 days to ...; every counter covered." A guard that never fires may be healthy |
| CUT-CANDIDATE | `warn` | "Cut candidate: <the condition> (...). A person decides." The reading proposes a review and never cuts anything |
| UNMEASURED | `unknown` | "Unmeasured: no keep or cut call yet (<the counters that are blind>), ..." |
| no file, or one that cannot be read | `unknown` | "No ledger yet: ..." Never a number, never zero |

The numbers are the counters the reading rule uses first, then the rest by name, at most six; when more exist one number
says how many are not shown. A counter is shown as **a number only when it is covered and exact**. Otherwise it reads
`unknown: <reason>` (the spec's five reasons, `no reading`, `no ledger yet`), `at least N, 60% covered` (partial), or
`unknown: 30% covered` (blind: the number is withheld, because a counter that may be missing rows supports nothing). An
estimate or a rebuilt count says so. Coverage is rounded down, so a partial counter never reads 90%. Lines the reader
skipped are counted in the headline. A counter is labelled only with a name from the spec's "Counters" table; any other
counter shows its value under "other counter, not in vocabulary", never its own name. A placeholder under a deprecated
retired-word name (`caught`, `minutes_saved`: `value: null` with its reason) is counted on one last number, "not measured:
N counters", and never named. A ledger with a line that gives a number to a counter whose name uses a retired word reads
"Ledger not valid: a counter name uses a retired word", with no numbers.

While `ledger.enabled` is on, the tool ids `ledger-*` belong to these cards: a card in the drop directory with such an id is
rejected (counted and logged with its reason), so there is still one card per tool.

**What it costs.** Per refresh, one `lstat` per listed tool. A file is read once through `src/weatherdeck/ledger.py` and the
result kept until the file changes or the UTC day ends. A symlink or a non-file is not read. The household (`tv`) view shows
title, status word, mode and age only, and the public view shows no cards, as for every card.

**What it does not say.** It says what the rows say and nothing about whether anyone acted on a tool; the words "caught" and
"saved" are retired ([honesty.md](honesty.md)). `ok` on a ledger card means "nothing to do", not "this tool is proven worth
having": read the headline, and the spec's rule for when a number may be cited outside.

## Writing the ledger (off unless asked)

The host can write its own ledger, `weatherdeck.jsonl`, so the Weatherdeck ledger card has numbers to read ([ledger-spec.md](ledger-spec.md)).
It is **off by default**: with `ledger.write` unset or false the host never writes one. It reads only what the host already
keeps in `history.sqlite` (`pushes`, `events`, `done`, `sources`), starts no process and no thread, opens no socket and reads
no clock of its own.

```json
{ "ledger": { "enabled": true, "write": true, "tools": ["weatherdeck"], "host": "host-a" } }
```

| Key | Meaning |
| --- | --- |
| `ledger.write` | `false` by default. `true` lets the host write the closed days it has not written, after an accepted push has released the ingest lock, when the UTC day has changed (and on the first push after it starts). A day counts as closed 300 s after it ends, so a push stamped just before midnight that was still waiting on the lock is counted. One push writes at most 2 days; a backlog (the first run, or after the host was off) is spread over the next pushes. Also `weatherdeck ledger write` at any time, which does not need this key and writes every closed day at once, and `weatherdeck ledger write --dry-run`, which prints the lines and writes nothing |
| `ledger.host` | The host's label in every line (letters, digits, `.`, `_`, `-`, at most 64). Default: an opaque label derived from the machine's name and the install's salt, never the name. Read only for the first write: see "The host label" below |
| `ledger.dir` | Where `weatherdeck.jsonl` goes, as for the cards (default `<data dir>/ledger`, so the cards find it with no further setting) |

**What a line is.** One counter over one closed UTC day, as the spec says. A day is written once; the host never edits a line.
The numbers are counts of the host's own rows, each with its table, its filter, the first and last row counted, a digest of
exactly those rows and the rows left out (`excluded`):

| Counter | Counted from | Quality |
| --- | --- | --- |
| `pushes_ok`, `pushes_rejected` | `pushes` rows by `status` (the received log holds the same pushes but rotates sooner, so the table is read) | exact |
| `pushes_ok_<key>` | the same, for one source. `<key>` is the first 12 hex digits of the HMAC-SHA-256, keyed with the install's salt, of `weatherdeck-ledger`, U+001F and the source id: the source id is not written, and without the salt the key cannot be checked against a guessed id. Sources the host knows from the day on | exact |
| `feeds_missed` | the sum of `gap` over accepted pushes: feeds lost in transit | exact |
| `calls_raised` | `events` of kind `approval` or `alert`: what the board surfaced as a call | exact rows, `lower-bound` on the day a source began (the first feed of a source yields no event) |
| `surfaced_failed` | `events` of kind `failed`: a lane the source itself reported failed or blocked | as `calls_raised` |
| `restarts` | `events` of kind `restart` | as `calls_raised` |
| `landed` | `done` rows: work that finished and was reported done | exact |
| `silence_episodes` | rebuilt from the pushes: a source in `sources` whose last accepted push is followed by none from it for `thresholds.lost_after_s` (900 s), counted on the day those seconds ended | `rebuilt` |

Sample rows (`mode: sample`, `sample = 1`) are left out and counted in `excluded`. `src.canon` says how a row is written for
the digest: compact JSON, keys sorted, rows in id order, joined by a newline; the row has the table's own columns without any
title, so a digest can be recomputed after titles are dropped.

**What stays unknown, and the one field.** Each is written every day as a line with `value: null`, its reason and, in `needs`,
the one field that would make it measurable:

| Counter | Reason | The field |
| --- | --- | --- |
| `surfaced_cleared` (the value event) | `field-absent` | an `events` row written when the host itself moves a lane, a source, a machine or a call onto or off a condition, citing the feed field that caused it. Until then the card reads Unmeasured: the board's own off-course, silent and lost conditions are computed when a view is built and forgotten |
| `views` | `not-measurable` | none that is honest: a request is not a person looking |
| `events_missed` | `not-measurable` | what a viewer had seen when a condition changed; that stays in the viewer's browser |
| every push-derived counter, on a day with no push at all | `field-absent` | a heartbeat of the host's own running, so a day the host was off is not read as a quiet day |

A count that is only a floor (the first day of the history, or a day partly covered) is written `lower-bound`, and a floor of
nothing is written as unknown (`source-truncated`), never as zero.

**The install's salt.** The first write creates `<data dir>/ledger.salt` (32 random bytes as hex, mode 600) and every later
one reads it; it is never written into a ledger or a feed. The source keys and the default host label are keyed with it, so
they are stable on this install and **not comparable across installs**: the same source id gives a different key on another
machine, or after the salt file is deleted (which also makes every later key differ from the earlier ones in the file).

**The host label.** The label used on the first write is recorded in `<data dir>/ledger-writer.json` and kept on every later
run, whatever `ledger.host` or the machine's name becomes, so a rename does not make the days already written look unwritten.
A day whose window the ledger already holds is never written again, under any label. To start a new label on purpose, set
`ledger.host` (or leave it unset for the default) and delete `ledger-writer.json`; the next write records the new label, and
only days not yet in the ledger are written under it.

**The file is only appended to.** The writer holds a lock, reads the whole file, writes the old bytes and the new lines to a
temporary file in the same folder, syncs it and renames it over: a reader sees the old file or the new one. It refuses, and
leaves the file exactly as it is, when the file is a symlink or not a plain file, cannot be read as UTF-8, ends in a torn
line, holds lines of another tool, or is larger than `ledger.max_kb`; `weatherdeck ledger write` then prints why and exits 1, and
the host logs it once a day. It never creates a source: with no push yet it writes nothing. A run writes at most the last 60
closed days, and only days the history holds.

**What it costs.** Measured on 2026-10-12, one Linux machine under WSL2 (24 threads, Python 3.14, shared with other jobs), on a
synthetic history of ten sources pushing every 30 s (28,800 pushes a day, 30 days): one day's lines took 0.21 CPU s once a day
(21 lines, 14 KB added; the 30-day first run 5.7 CPU s with `weatherdeck ledger write`, or about 0.4 CPU s on each of the next 15
pushes from the host), a run with nothing new 0.007 CPU s, and the check after each accepted push is one comparison, about
1 µs. The writing runs after the ingest lock is released, so other sources' pushes do not wait for it. At that size the file grows about 5 MB a year, so the default `ledger.max_kb` (8192) lasts about 19 months; raise it before then. Fewer or slower sources cost less in every figure.

**What it does not say.** It counts rows and says nothing about whether anyone acted on what the board showed; the words
"caught" and "saved" are retired ([honesty.md](honesty.md)). A condition that came and went between two feeds is on no row,
and the host's own conditions are not recorded: read the table above.

## Getting a card onto the board

The drop directory is `cards.dir` in the config, by default `<data dir>/cards`. Three ways in, none of which runs the tool
from the board:

1. The tool writes into it: `<tool> ... --card /path/to/cards` (each tool documents its own flag). Write to a temporary name and
   rename, or use the tool's command that does; files not ending in `.json` are ignored.
2. A pipe: `<tool> card | weatherdeck card add -` validates, then writes `<tool>.json` atomically.
3. A copy: `weatherdeck card add path/to/card.json`.

Run the tool's command from its own scheduler (cron, a timer, the tool's own watch mode). The board does not poll tools; it
re-reads the directory each time it builds the view (at most every 15 s).

```
weatherdeck card validate examples/cards          # the good examples: exit 0
weatherdeck card validate examples/cards-invalid  # one reason each: exit 1
weatherdeck card list                             # what the board would show now, and what it rejected
```

`examples/cards/` holds three valid cards (a repair-advice tool with a `mode`, a host pool, a release gate with its own
window); `examples/cards-invalid/` holds one invalid card per rule. `weatherdeck run --demo` writes the three good ones, restamped
every few seconds, so the tiles are visible with synthetic data.

## Writing a card from a tool

Keep it small and keep the tool independent of the board:

- Build the object, set `updated_at` to when the data was true (not necessarily now), and pick `status` from what a person
  would want to be told: `ok` nothing to do, `warn` look soon, `bad` act, `unknown` the tool could not tell.
- Put the one thing worth knowing in `headline`; put counts in `numbers`.
- Set `stale_after_s` to a few times how often the tool runs.
- Do not call the dashboard. Print the card, or write the file; let the operator choose how it gets to the board.
- Check it with `weatherdeck card validate`.

## Compatibility

A 1.x reader ignores fields it does not know and treats a missing optional field as absent. The `status` set is closed for
all of 1.x; adding a word is a major version.
