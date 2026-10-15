# Write a pusher for your tool

An **adapter** (also called a pusher) is a small program that reads one tool's own files or commands, turns what it
finds into a `lookout.feed` document, and pushes that document to a Weatherdeck host. The host never reaches out to your
tool: it only keeps the last good document each source sent and draws it. This page is for someone who wants their own
tool on the board. It covers what to send, how to deliver it, the rules that keep the board honest, and a way to test an
adapter without running the real tool.

The field-by-field definition is [feed-spec.md](feed-spec.md). The rules the board keeps are in
[honesty.md](honesty.md). A working, standard-library-only starting point is `examples/adapter/push_example.py`, with its
`work.example.json` and `sinks.example.txt`. Read the example once before you write anything: it is under 200 lines.

## What an adapter does

1. **Reads** what your tool already records: a state file, a database, a command's output, a log. It reads; it does not
   change your tool's files.
2. **Maps** that to the feed: one `item` per piece of work, one `attention` card per thing that waits on a person, one
   `machines[]` row for the computer it runs on, and so on. Only the envelope is required (`schema`, `schema_version`,
   `source.id`); everything else is optional, so start small and add fields as your tool can say them truthfully.
3. **Pushes** the whole current state, every few seconds, to every host named in a sinks file.

A first version can be a dozen lines: a source id and a list of items.

```json
{
  "schema": "lookout.feed",
  "schema_version": "1.0",
  "source": { "id": "my-laptop" },
  "items": [{ "id": "build", "title": "Nightly build", "state": "running" }]
}
```

The schema id says `lookout.feed` on purpose. It is the wire name, and it does not change when the program is renamed.

## The wire schema in brief

- **Version.** Send the highest minor version whose fields you use (`"1.0"` for the example above). A host reads every
  `1.x` feed and ignores fields it does not know, so an adapter that sends a newer field to an older host loses nothing
  but that field. A higher major version is rejected.
- **Source.** `source.id` is stable and matches `[a-z0-9][a-z0-9._-]{0,47}`. `source.machine` names the computer; several
  sources may share one. `source.kind` is any short word shown as a role.
- **Producer.** `producer` is `{name, version, boot_id, seq, mode}`. `version` is your adapter's version, so the board can
  say which software each machine reports from. `seq` rises within a `boot_id`; the host refuses a repeat or a lower
  value as a replay. Choose a new `boot_id` each time your program starts, and keep one `seq` counter per host.
- **Times** are RFC 3339 UTC strings ending in `Z`. **Limits** are enforced, not trimmed: a push over a limit (256 KiB
  body, 2000 characters a string, 60 items, 30 attention cards and so on, listed in the spec) is rejected whole, so cap
  your lists and say so with `omitted[]` instead of sending more.
- **Each push is the complete current state.** Only `events[]` is incremental.
- **`interval_s`** says how often you push. The board's live, late and silent levels are multiples of it, so declare the
  real figure.

The fields most adapters add next:

| To say | Send |
| --- | --- |
| what each piece of work is doing | `items[].state` (`running`, `waiting`, `done`, `blocked`, `paused`, `failed`, `unknown`), `summary`, `doing` |
| how far along it is | `items[].progress`: a floor and a ceiling, or steps with no percent |
| something needs a person | an `attention[]` card with `severity: action`, a `title` and a `detail` |
| why work is held | `waiting_on` (`gate`, `pr`, `human`, `capacity`, `quiet_hours`, `external`) and `until` |
| the machine's health | `machines[]`: `status`, `load`, `mem`, `disks`, with `as_of` |
| what you cost the machine | `pace`, when you stretch your own intervals on purpose |
| what an older version cannot do | `producer.meaning[]`: `{since, effect}`, one plain sentence each |

## Sinks: where the document goes

A **sinks file** is one host per line: `name  transport  target  credential`. A line starting with `!` is switched off
without deleting it, and `#` starts a comment. The shape is in `examples/adapter/sinks.example.txt`.

- **`http`**: `POST <target>/api/ingest`, body is the document, `Content-Type: application/json` (anything else is refused
  with 415), `Authorization: Bearer <token>`. Tokens are per source and bound to its id; the host owner makes one with
  `weatherdeck token new <source-id>`. A host that has no tokens yet accepts pushes from its own machine without one.
- **`local`**: run `weatherdeck ingest` and write the document on its standard input. For a host on the same machine.
- **Forced-command SSH**: for a machine that should push over SSH with no token on the wire. The host owner adds one key
  per source to `authorized_keys` with a forced command that pins the source id (`weatherdeck startup authorized-key
  --source ID --key "..."` prints the line; [hosting.md](hosting.md) explains it). Your adapter runs `ssh -o
  BatchMode=yes <host> weatherdeck-ingest` with the document on standard input. Exit 0 means accepted, 65 means
  rejected (the reason is on standard output), 70 means an internal error. The client command `weatherdeck-check` is a
  read-only probe: it answers `ok` and changes nothing, which is what a `check` command in your adapter should use.

The host answers `ok seq=N received_at=...`, or `rejected: <reason>` (HTTP 422, or 409 for a replayed `seq`).

How to behave toward hosts:

- Hosts are independent: separate timeouts, a separate `seq` per host, separate back-off. A down host is normal.
- Say it once when a host goes down and once when it comes back, retry with back-off capped at five minutes, and never
  let one slow host delay the others.
- Name a refusal plainly. A missing token file, a key the host turned away and a host that did not answer are three
  different things; print which one it was, and do not call a refusal "down".
- On start, print where you are pushing and how often, so a person who runs the program by hand can see that it is
  alive. A loop that does nothing visible looks like a loop that does nothing.

## Honesty rules for adapters

The board says only what a source reported, and says so when it cannot say more. An adapter agrees to the same rules
([honesty.md](honesty.md) has the full list):

1. **Unknown is not zero.** If you could not read a value, leave the field out or send `unknown`. Never send `0`, `false`,
   `ok` or an empty list to fill a gap. A zero on the board is a source saying zero. A state you do not recognise is
   `unknown`, not `running`.
2. **Never guess.** Do not derive a state, a percent or a cause the tool did not record. A percent is a range
   (`percent_floor`, `percent_ceiling`); send no percent when none is honest. Send the `cause` of a state only when you
   know the rule that chose it, as a short fixed id.
3. **Say how old a reading is.** Give `as_of` on machine rows, calls and counts that you read from a cache. A number that
   came from a copy and not from a live reading says so (`waiting.basis`, `waiting.verified: false`) and is shown as
   unverified.
4. **Do not hide a cut list.** If you cap a list, send the true total in `omitted[]`. Counts come from the full total,
   not from what fits.
5. **Silence is a state, never a pass.** If a collector fails, report it in `collectors[]` with `status: error` and the
   error. Do not push a feed that looks healthy because one reader broke. If you cannot read anything, push nothing, and
   let the board show you as silent.
6. **Slow down openly.** If you give way on a busy machine or on battery, say so in `pace` (and stretch `interval_s`), so
   the board reads slower reports as slowed on purpose, not as silence.
7. **Keep user text out of rules.** Put a worker's own status line into `doing` and your reading of it into `summary`.
   The board never shows a worker's text as a cause.
8. **Stay inside your budget.** An adapter runs on someone's computer. Keep its CPU, its reads and its network use small
   and measured, and report them in `pace.cost` when they matter.

## Test it without the real tool: record and replay

You can test an adapter without the tool it reads. The idea is to record, and then replay, **the files you read**:

1. **Record.** Copy the inputs your adapter reads (the state files, a command's output saved to a file, a database
   dump) into a folder of fixtures. Make every fixture synthetic or redacted: no real names, hosts, paths or tokens. Keep
   one folder per situation you care about: a normal day, an empty one, a file that is half written, a file in an older
   format, a tool that is not installed.
2. **Replay.** Give your adapter a way to read a fixture folder in place of the real one (a `--fixture DIR` option is
   enough) and to run once and print the feed instead of pushing it. Run it over every folder.
3. **Check each result.** For each fixture:
   - the output validates against the schema (the host's own check is `weatherdeck.schema.validate` in `src/`, or
     push the output to a throwaway host and read the answer);
   - it carries the states and counts you expect, written down next to the fixture;
   - **the gaps stay gaps.** Delete a file, truncate one, corrupt one: the field that depended on it must be absent or
     `unknown`, never `0` and never `ok`. This is the check that finds the dishonest default, and it is the most
     valuable one.
   - two runs over the same fixture give the same document apart from the clock and `seq`.
4. **Keep it cheap.** The replay should run in seconds with no network, so it can run before every push to your
   repository.

A fixture folder plus a script that loops over it is all this takes; it needs no host and no real tool.

For the delivery side, run your adapter against a host you start on your own machine (`weatherdeck run --demo` serves a
board; a host with no tokens accepts pushes from the same machine), then read what arrived with `weatherdeck received
--summary` and `GET /healthz`. Test the unhappy paths as well: stop the host and check that you log one line, start it
again and check that you log one line, and give a wrong token and check that the message says the host refused it.

## A checklist before you share an adapter

- It sends only what its tool recorded, and every unreadable value is absent or `unknown`.
- `producer.version` is set, and `producer.meaning[]` says what older versions could not do.
- A refused host, a down host and a missing credential each have their own plain message.
- Every list that can grow is capped and reports its true total.
- The fixtures are synthetic, and the replay passes over them, including the broken ones.
- It names no real machine, person or token in its code, its examples or its fixtures.
