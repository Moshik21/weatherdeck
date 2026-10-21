# Cua Spaces on the board

`examples/adapter/cua_push.py` shows Cua Spaces and their agent runs on the board. It polls the `cua` command-line tool
with `--json`, turns the answers into a `lookout.feed` document ([feed-spec.md](feed-spec.md)) and pushes it to every host in a sinks
file, the way `push_example.py` does (it imports that file's sinks and delivery, so keep the two in one folder). It is standard library
only, read-only towards Cua, deterministic and makes no model call. It does not copy any Cua code: it runs the `cua` command and reads
what it prints.

**Not checked against a live cua.** The `cua` command was not available when this was written. Every command name, field name and status
word below comes from Cua's published description (Spaces launched on 2026-10-19; the tool contract is v0.7.0 and marked
experimental), or is an assumption, and none has been run. The fixtures in `tests/fixtures/cua/` are hand-written to those shapes, not
recorded. Treat the first run against a real cua as the check, and expect a field to have another name: where it does, the board shows
that part as unknown and the pusher says so once in the Logbook, as below.

## Run it

```
python3 examples/adapter/cua_push.py --sinks sinks.txt            # poll and push every 60 s
python3 examples/adapter/cua_push.py --sinks sinks.txt --once
python3 examples/adapter/cua_push.py --fixture tests/fixtures/cua/normal     # print the feed for recorded cua output, push nothing
```

The sinks file is the one in [adapters.md](adapters.md). The source id is `cua`; give a second Cua account its own pusher and token.
`--every` is the poll interval in seconds (default 60, never below 30), declared as `interval_s`, so the board calls the source late
or silent in multiples of it. Each pass runs `cua spaces ls`, `cua agent ls` and `cua notifications ls`; the version and usage are read
at most every five minutes.

**Polling is kept modest on purpose.** Cua defines a live session as a stream held open through its relay, and it is not documented
whether listing or status calls count against a plan's limits, nor what the relay's rate limits are. Do not set `--every` lower than you need.

## What it runs

Only read-only commands, each with `--json` where it takes one. A command this cua does not have is a surface left empty and marked
`disabled` in the feed's `collectors[]`, never a zero.

| Command | Used for | Shape assumed |
| --- | --- | --- |
| `cua --version` | the version, on the `cua` collector's label and in one Logbook note | a line holding a dotted number |
| `cua spaces ls --json` | `machines[]` | a list, or an object with `spaces`: `id`, `name`, `host` or `host_name`, `phase`, `status` |
| `cua agent ls --json` | `items[]` | a list, or an object with `runs`: `id`, `space` (a Space's id or name), `agent`, `name`, `status`, `accepts_message`, `liveness`, `task`, `started_at` |
| `cua agent status ID --json` | only a run whose list row has no `status` (at most 8 a pass) | `status`, `accepts_message`, `liveness` |
| `cua notifications ls --json` | `attention[]` and `events[]` | a list, or an object with `notifications`: `id`, `kind` (`access_request`, `run_failed`, `run_crashed`, `turn_end`), `run`, `title` or `message`, `at`, `status` (`approved` marks an answered ask) |
| `cua usage --json` | `meters.accounts[]` | `plan`, and `live_sessions` and `remote_hours` as `{used, limit, resets_at}` |

Run status is Cua's own `running`, `idle`, `failed`, `crashed` or `unknown`. Cua's description also lists `alive` as an agent
state; this pusher reads that from a `liveness` field (`alive`, `crashed`, `unknown`) and does not take it for a run status. Which field
Cua really uses for it is one of the things to check first.

## The mapping

**Spaces become machines.** One machine per host computer (`host`, else `host_name`), its Spaces listed in `extras` with their phase. A Space
with no host goes under "host not reported".

| Cua says | The machine reads |
| --- | --- |
| every Space of the host is `offline` or `not sharing` | `down`, never ok, with a warning on each Space; no "lost" declaration, so a laptop that closed does not raise a critical card |
| some Spaces offline, some up | `warn` |
| every Space has a phase this pusher knows as up (`ready`, `running`, `sharing`; assumed) | `ok`: Cua says its Spaces are up, nothing about the computer's health |
| any other phase, or none | `unknown` |

Cua reports no host load, memory or disk, so the machine row carries none: they are absent, not zero. `lanes` counts the runs Cua lists for the
host and how many are running; for a host that is offline, or whose Space has a phase not known as up, `running` is left out, because Cua documents that
runs survive a connection drop but not the host going offline.

**Runs become lanes** (`items[]`, id `space:run`, project chip "Cua"). Only Cua's status chooses the lane word, with a fixed cause id that
this pusher owns (a board words it; it never shows the run's text as a cause). The run's own task text goes in `doing`, only while running.

| Cua says | Item state | Lane word | `lane.cause` | `agent.state` |
| --- | --- | --- | --- | --- |
| `running` | running | Working | `cua-run-running` | not reported |
| `idle`, `accepts_message: true` | waiting | Waiting on the supervisor | `cua-run-idle-takes-message` | not reported |
| `idle`, any other | unknown | Can't tell | `cua-run-idle` | not reported |
| `failed` | failed | Needs attention | `cua-run-failed` | not reported |
| `crashed` | failed | Needs attention | `cua-run-crashed` | `gone` |
| `unknown` | unknown | Can't tell | `cua-run-unknown` | `unknown` |
| any other word | unknown | Can't tell | `cua-run-status-unrecognised` | `unknown` |
| any status, but its Space's host is offline | unknown | Can't tell | `cua-host-offline` | `unknown` |
| any status, but its Space's phase is none or not one this pusher knows as up or offline | unknown | Can't tell | `cua-space-phase-unknown` | `unknown` |
| any status, but its Space is not in the Spaces list, the list could not be read, or the id or name the run gives fits more than one Space | unknown | Can't tell | `cua-space-unlisted` | `unknown` |

`agent.state` is only what Cua says: `liveness` `alive` is `alive`, `crashed` is `gone`, `unknown` is `unknown`; a running run with no
`liveness` has no agent state (its stern window stays shuttered) rather than a guessed `alive`. There is no percent and no `last_word`:
Cua has neither.

**Notifications.** An access request becomes a call (`attention[]`, kind `approval`, severity `action`) and a run failure or crash a call of
kind `decision`, each naming its lane when the run is listed. The card's text is Cua's own, cut to 200 characters, and it says the answer
goes in Cua: the board is read-only. A notification whose `status` is `approved` is never sent,
because the board cannot tell an answered card from the feed. A turn end becomes one `events[]` line, once per notification id for as long
as the pusher runs. A kind not named here is left out and said once.

**Usage** becomes one allowance chip (`meters.accounts[]`, provider "Cua", the plan as the account) with a window for live sessions and one
for remote hours, each `percent_remaining` from `used` and `limit` and the reset time Cua gives. `runway` is `unknown`: the pusher makes no
projection. A window whose figures are not both numbers (with a limit above 0) is left out; with none readable, no chip is sent.

## When cua cannot be read

| Situation | What happens |
| --- | --- |
| `cua` is not installed | one line on standard error, exit code 0, nothing pushed (a running pusher says it once and keeps trying) |
| not signed in (the command fails with `not signed in`) | one line, nothing pushed; the board shows the source silent, which is what it is |
| a command this cua lacks (it fails with `unknown command`) | that surface empty, its collector `disabled`, one Logbook note |
| an answer of a shape not expected | that surface empty, its collector `error`, one Logbook note; the rest still reads |
| a row not understood | the row is left out or reads Can't tell, the collector counts a `warnings`, one Logbook note |
| nothing at all readable | nothing pushed, one line on standard error |

Each note is sent once as an `events[]` note naming the source, not as a call; the state stays in `collectors[]` every push. The cua version
is on the `cua` collector's label and in a note when it first appears and whenever it changes, since names and shapes may change between minor
versions. (`producer.version` stays this pusher's own version, "1", as the feed spec defines it; Cua's version is not carried there.)

Lists are cut at the feed's limits (60 lanes, 30 calls, 12 machines, 12 extras a machine, lanes needing attention kept first) and each cut says
so in `omitted[]` with the true total.

## What is left unknown, and why

- A machine's load, memory, disk, battery and uptime: Cua reports none.
- A run's percent, steps and last word: Cua reports none.
- `agent.state` of a run Cua did not give a `liveness` for, and of every run on an offline host.
- Any run, and the running count, on an offline host: its state is not known. The same holds for a run on a Space whose phase is none or not a known one, for a run whose Space is not in the Spaces list, whose Space name two Spaces share (it is not guessed which), and for every run while `cua spaces ls` cannot be read. A run whose id repeats an earlier row's is left out and counted as a warning, since a notification names a run by its id alone.
- `runway` of the allowance: the pusher does not project.
- What polling costs against a plan: Cua does not say.
- How long Cua keeps notifications, so a turn end older than the list is never seen.

## Safety

- **The hosted relay can read what it proxies.** Traffic through `relay.cua.ai` is decrypted there, so a run's text, files and prompts
  that go through it are readable by the relay. Prefer Spaces on `direct:`, your LAN or a private network, and keep anything private off a Space
  that is reached through the relay. This pusher sends the board only what `cua` printed, but notification and run text can contain what
  the agents said.
- The pusher reads text from the agents' own records (a run's name and task, a notification's message). The board shows it as text,
  never as a rule, and the pusher cuts it to 200 characters.
- It starts no run, stops none and answers no request. It passes no credential to `cua` and keeps none; it signs nothing in.
- Cua's Spaces code is FSL-1.1-MIT and none of it is here.

Tests: `python3 -m unittest tests.test_cuapush`.
