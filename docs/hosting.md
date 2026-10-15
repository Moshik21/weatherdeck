# Hosting, config and transports

## The command

`bin/weatherdeck` is one Python file plus the `src/weatherdeck` package: standard library only, no admin or
root, the same command on Windows, macOS and Linux (and WSL). Python 3.9 to 3.14 (3.8 is not supported). On Windows use
`bin\weatherdeck.cmd` (it finds `py -3` or `python`), or `py -3 bin\weatherdeck ...`, from cmd or
PowerShell; on macOS and Linux `bin/weatherdeck` or `python3 bin/weatherdeck`. Everything below works the
same on all three. No model or LLM is called anywhere: the code is deterministic.

| Command | Does |
| --- | --- |
| `weatherdeck run [--demo] [--scenario NAME]` | Run in the foreground. `--demo` serves synthetic sources from a separate store (`<data>/demo`, wiped each run); `--scenario` picks a named variant from `examples/demo/scenarios.json` (its top-level keys, for example `sea-life` or `horizon`). |
| `weatherdeck on` | Start in the background: `server.json` (pid, URLs) and `server.out` in the data dir. Waits up to 8 s for the listeners and prints the URLs, or the last log lines on failure. Already running: prints the URLs. |
| `weatherdeck off` | Stop: checks the pid still belongs to this program, SIGTERM, waits 8 s, then SIGKILL. |
| `weatherdeck restart`, `status`, `logs` | Restart; show state, URLs, data dir and what is reporting; show the end of the log. |
| `weatherdeck ingest [--source ID]` | Read one feed document on stdin. Through a forced-command SSH key, the client command `weatherdeck-check` makes it answer `ok ...` and change nothing (a health probe). |
| `weatherdeck privacy [on\|off\|status]` | Privacy mode: the profiles marked `privacy` (the `tv` profile) show counts only while it is on. A marker file `privacy.on` in the data dir; acts within seconds, on the host. |
| `weatherdeck startup install\|remove\|status` | Windows, no admin rights: start the host at logon (a per-user logon task, or a script in the Startup folder if Windows refuses the task). `install --config-from FILE` also puts a config in place; `--dry-run` previews. `install` starts the host through the logon task, so it outlives an SSH session; `--no-start` leaves it for the next logon. |
| `weatherdeck startup authorized-key --source ID --key "ssh-ed25519 ..."` | Print the one `authorized_keys` line (forced command, `restrict`) for a pushing machine's key; on Windows also write the small wrapper script it names. Never edits `authorized_keys`. |
| `weatherdeck replay [--url URL] [--only a,b] [--silence ID:SECONDS] [--scenario NAME]` | Push the synthetic demo sources (or a named variant) to a running host. |
| `weatherdeck theme list\|check [NAME]` | List the page themes; check one (schema, font integrity and licences, every contrast pair recomputed). |
| `weatherdeck token new\|list\|revoke <source-id>` | Per-source push tokens. |
| `weatherdeck token new\|list\|revoke --read <profile>` | A read token for a view profile. |
| `weatherdeck invite --machine ID [--source ID] [--ttl 15m] [--url URL]` | Add a machine: mint a push token for its source (default `beat-<machine>`) and print one join string (address, ids, expiry, token), shown once. The host refuses the token once the invite expires before a first accepted push. See [onboarding.md](onboarding.md). |
| `weatherdeck join --dry-run [STRING]` | On the new machine: the preflight only, writing nothing. Each check passes or names its failure with one next step; paste the string at the hidden prompt. See [onboarding.md](onboarding.md). |
| `weatherdeck card validate FILE\|DIR\|-` | Check add-in cards against the card schema; one line each, exit 0 only if all are valid. `--json` for machines. See [ADDINS.md](ADDINS.md). |
| `weatherdeck card add FILE\|-` | Validate a card, then write it atomically as `<tool>.json` into the card drop directory. |
| `weatherdeck card list` | The cards the board would show now (age, stale) and the card files it rejected, with reasons. |
| `weatherdeck doctor [--url URL --source ID --token-file F] [--read-token-file F] [--pusher-state F]` | On a pushing machine, read-only: is the host accepting this source's pushes, and if not why (service, interpreter, token file, host, the host's own receipt, the beat's or pusher's push state, clock and version skew). One line per check, `not checked: <why>` when a check cannot be made; exit 0 only when the host accepted a push within three intervals. See [doctor.md](doctor.md). |
| `weatherdeck doctor --host` | On the host, read-only: invited sources never seen, sources and addresses whose last push was refused, push tokens never used, loopback pushers that are or will be refused. See [doctor.md](doctor.md). |
| `weatherdeck forget <source-id>` | Remove a source and its stored feed. |
| `weatherdeck received [--tail N] [--diff] [--source ID] [--json] [--summary]` | The received log: one line per push from any source, accepted or rejected (time, source, `seq`, transport, the client address of an HTTP push (never shown on a page), size, gap, the count per section, and the exact titles whenever they changed since that source's previous feed). `--diff` lists the titles that came, went or changed state; `--summary` one line per source and day (pushes, rejections, longest gap, the waiting-on-you range and the distinct calls). |

Global options: `--data DIR` (or `$WEATHERDECK_DATA`), `--config FILE` (or `$WEATHERDECK_CONFIG`; default
`<data>/config.json`), `--demo`. `run`, `on` and `restart` also take `--port N` and `--bind ADDR`
(repeatable). The default data dir is the platform's per-user data directory. One data dir per
running instance: several hosts, or several instances on one machine, run side by side with
different data dirs and ports. Each page shows which host serves it.

Default data dir: `%LOCALAPPDATA%\weatherdeck` on Windows, `~/Library/Application Support/weatherdeck` on
macOS, `~/.local/share/weatherdeck` (or `$XDG_DATA_HOME/weatherdeck`) on Linux. `weatherdeck off` asks the host
to stop with a `stop.request` file (graceful on every platform) and only terminates it if it does
not stop in 8 s; it never touches a pid it cannot confirm is this host (the host answers
`/healthz` with a per-run id), so a stale `server.json` is safe.

Everything under the data dir is private to the user (mode 0600/0700): `history.sqlite`, `sources/`,
`rejected/`, `cards/`, `tokens.json` (SHA-256 of tokens only), `invites.json` (the invite registry, [onboarding.md](onboarding.md)), `ingest.log`, `server.log` (1 MB, one backup), and
`received-log.jsonl` (rotated at `history.received_log_kb`, 2048 KB, keeping `history.received_log_keep`, 3, older files).

## Binding and profiles

`hosts.bind` is a list of entries. An entry is an address, or `{"address": ..., "profiles": [...]}`
to serve only some profiles. An address is `localhost`, a literal IP (a LAN or VPN address), or
`auto:<cidr>` (every local interface address inside that range, if present; rechecked every 15 s so
a late-starting VPN or wifi is picked up). `0.0.0.0` and `::` are refused. The default is
`["localhost"]`, so a fresh install is not reachable from the network.

```json
"hosts": { "port": 8787, "bind": [
  "localhost",
  { "address": "auto:100.64.0.0/10", "profiles": ["full"] },
  { "address": "auto:192.168.1.0/24", "profiles": ["public"] }
] }
```

That serves everything on localhost, the full view over a VPN range, and only the public view to the
home LAN (a TV opens `http://<host LAN address>:8787/`).

A **profile** is a named view of the same data with its own URL path, redaction level and optional
read token (`profiles` in the config; defaults below).

| Profile | Path | Shows |
| --- | --- | --- |
| `full` | `/` | everything the feeds carry |
| `tv` | `/tv/` | for a screen the household can see: item and group (repo) titles, ids and pull-request links stay; no free text about what a worker is doing (details, state text, last events, attention details, gate notes, failing test names), no review-board answer link, no machine extras, health reasons or beat errors. `"privacy": true`, so privacy mode turns it into the `public` view |
| `public` | `/public/` | counts, group and machine names, states, percent ranges and ages. No item titles, details, links (review-board answer links included), branch names, paths, step labels, queue or done rows, attention text, machine extras, health reasons or beat errors; ids are opaque |

Redaction happens on the host while the view is built, cached per profile; the browser never
receives what a profile hides. A listener that serves one profile also serves it at `/`; other
profiles' paths return 404 there. Levels for custom profiles: `none`, `household` (see `tv`),
`guest` (titles, details, links and ids stripped; machine and group names kept), `public`. A profile
with `"privacy": true` is shown at the `public` level while privacy mode is on (`weatherdeck privacy on`).

Read tokens: `weatherdeck token new --read public` prints one (shown once; only its hash is stored).
Open the view once as `http://host:8787/?key=<token>`; the browser keeps it in an HttpOnly cookie and
the address is cleaned. Tools may send `Authorization: Bearer <token>`. Without a read token a
profile is open to whoever can reach the listener, so bind it only where that is acceptable.

For a full-screen kiosk on the host itself: `chromium --kiosk http://127.0.0.1:8787/` (or any
browser's kiosk/fullscreen mode; the page never navigates away and reloads itself only after a
successful probe, at most once a day at 04:00 and when the page code changes). HTTPS is a deployment
choice (a reverse proxy in front, bound to `localhost`), not a core feature.

## Config

One JSON file; every key has a default in `src/weatherdeck/defaults.json`, so the file only holds what
you change. It is re-read when it changes (port and bind need a restart).

| Key | Meaning |
| --- | --- |
| `title`, `data_dir` | Heading shown on the page; data dir (when not set by flag or environment) |
| `hosts.bind`, `hosts.port`, `hosts.label` | Listen entries (see Binding), port, and the name the page shows as "served by" (default: the machine's hostname, or "demo host" under `--demo`) |
| `hosts.allowed_hosts` | Extra names a browser or tool may use in the URL, beyond the bound addresses (see Security); a list, default none |
| `profiles.<name>.path`, `.redaction`, `.privacy` | Where each view lives, how much it hides, and whether privacy mode applies to it |
| `theme.name` | The look: a folder under `web/themes/` (`default`, `ship-deck`). One that is missing or fails `weatherdeck theme check` falls back to `default` |
| `theme.mode` | `auto` (night palette in quiet hours), `day`, `night` |
| `theme.motion` | `calm` (default: arrivals once, then still; the sea sways at its smallest and slowest), `full` (also short crew loops; the sea at normal size), `still` (nothing moves). Reduced motion in the browser means `still` |
| `theme.crt`, `theme.oled_safe` | Scanlines on a theme's scene art (never on text); a dark call plate by day so no large light block sits on an OLED panel |
| `theme.accents` | `background` (hex) for the default theme only. Status colours never change per theme, so other keys are ignored |
| `theme.logo`, `theme.group_colors` | A file in the data dir served at `/logo`; a colour per group id |
| `labels.*` | Every word on the page (English defaults), including `{placeholders}`. A theme's own words sit under these: a label set here always wins |
| `display.ambient` | `true` (default): the ship-deck scene's sea sways and the ship floats (whole-pixel steps, 8 to 10 frames a second, only while the page is visible). `false` keeps the scene still. `theme.motion: still` and the browser's reduced-motion setting also turn it off; `#ambient=0` or `#ambient=1` in the URL forces it off or on to compare, and `#ambient=stats` logs its cost |
| `display.row_sort` | The order of the rows on the open sea's log and on the Lists page: the six row words as keys (`you`, `stuck`, `unk`, `work`, `other`, `done`) and `housekeeping` (old records, last). Default: that order. A key left out sorts after the listed ones. See [theme-spec.md](theme-spec.md) 24.2 |
| `display.tz`, `display.quiet_hours` | IANA zone for clocks and "today" (null: the browser's); `{start, end}` or null |
| `display.idle_return_s` | Seconds without input after which a TV showing a deck (below the sea) or the page board (`#/board`) sails back to where it was opened: the open sea, or the deck a pinned TV was opened at (default 60; `0` never). The phone never returns by itself |
| `machines.aliases` | Machine ids an older install still reports, folded into the machine they really are, as one of its stations: `{"my-pc-linux": {"machine": "my-pc", "station": "Linux (WSL)"}}` (or just `"my-pc"`). Default none |
| `display.may_sleep` | Machine ids that sleep at night (default none). When every reporter of one goes quiet inside quiet hours (or the hour before) the board says "Asleep since 23:41", in the same grey and last-known style as silence, instead of "Silent"; outside quiet hours, or after 14 hours, it reads as silent again |
| `sound.enabled`, `sound.volume`, `sound.min_gap_s` | Off by default. On a TV only: two bells for a new call, a splash for a landing, thunder for a new critical (synthesized; no audio files). Never in quiet hours, never twice for one thing, at most one sound in `min_gap_s` (120); each is captioned in the Logbook. Browsers need one tap or key after load |
| `display.stage_of_step` | Which step ids (or a step label's first word) mean which stage, for a lane that does not send `items[].phase`: `{"test": "verify", "ci": "ship", ...}`. The stage puts the ship-deck sailor at a station on deck (see [theme-spec.md](theme-spec.md) section 17) |
| `display.landed.window_hours`, `display.landed.day_start` | What "landed" counts: a rolling window (default 24 hours), or, with `day_start` set (`"05:00"`), everything since the day last started at that hour. The chart's days begin then too |
| `display.allowance.providers` | The allowance providers to show, by name (`["orbit"]`); default `[]`, every provider a source sends |
| `display.stage_scale`, `display.stage_min_fill` | How the TV stage scales: `auto` (default) keeps whole device pixels while the stage fills at least `stage_min_fill` (0.8) of the window, else fits it in quarter device pixels; `whole` always whole pixels; `fit` always fills |
| `health.baseline_hours`, `.k`, `.floor`, `.sustain_min`, `.warmup_min` | When a machine reads struggling: its load per core stayed above max(baseline x `k`, `floor`) for `sustain_min` minutes, against a baseline averaged over `baseline_hours`, and never before `warmup_min` minutes of samples. Defaults 6, 1.5, 1.0, 10, 30 (see [feed-spec.md](feed-spec.md), "Machine strain") |
| `thresholds.*` | Live/late multiples of a source's interval, `lost_after_s`, `host_down_after_s`, `retry_every_s`, `collector_stale_s`, `agent_gone_min` (10): how long a lane's agent may be ended or gone before the lane needs action, and `supervision_wake_limit_s` (300): how old a supervisor's oldest unacknowledged wake may be, with no watcher running, before its card is critical, and `supervision_stale_critical_s` (1800): with no supervisor object, how old its heartbeat may be before its card is critical |
| `mirrors.expected`, `mirrors.retired` | The library (feed 1.10, "Library"): folders some source should report (`["notes/alpha"]`; one no source reports reads NOT REPORTING, and none is drawn unless listed), and folders retired on purpose (`[{"ns": "notes/old", "since": "2026-01-10", "note": "folded into notes/main"}]`, RETIRED with the date and note). Written by a person; the board never derives either. Default none |
| `display.queues.slow_min` | A shared queue reads backed up once its oldest waiter has waited this many minutes (default 30) |
| `display.coming_up.days` | How far ahead the coming-up list looks for dated holds and rests (default 7 days) |
| `display.since_last.enabled`, `.min_away_min`, `.show_min` | Since you last looked (on by default): a screen that comes back after `min_away_min` (10) says what landed, which calls are new and what newly got stuck since its last look, for `show_min` (15) or until dismissed. The look is kept only in that browser; nothing is sent to the host |
| `display.hint.enabled`, `.show_s` | The one-time first-visit hint on the phone that its ship opens its places (on by default); it goes for good when dismissed, when a place is opened, or after `show_s` (180) seconds shown. Since 0.4.1 the TV layout (a TV, a wall screen, any window 700 CSS px or wider) never shows it: a screen with no pointer could never dismiss it. The key (`?`) explains the board there |
| `display.fleet.flagship`, `.order`, `.max_ships` | One ship per machine (0.4.0). `flagship`: the machine id in front (default null: the primary source's machine). `order`: machine ids in the order their ships lie after the flagship (default `[]`: by name); ids not listed follow by name. `max_ships`: how many ships are drawn (default 6, at most 6), the rest sail as one convoy with a count plate. The order never follows state, so ships never swap places |
| `display.tour.enabled`, `.dwell_s`, `.sea_s`, `.pause_s`, `.places` | The auto-tour for a TV with no pointer (off by default): after `pause_s` (120) without input and `sea_s` (240) on the sea, it shows each of `places` (`["bridge", "gun-deck", "chart-room", "crows-nest"]`) for `dwell_s` (20) and sails home; any input stops it. Never on the `tv` profile (or any household-level or privacy profile): there it is refused, whatever the config says, and the browser console says so |
| `poll.tv_s`, `poll.phone_s` | How often the page asks for the view (it pauses when hidden) |
| `cards.dir`, `cards.stale_after_s`, `cards.max` | Add-in cards: the drop directory (default `<data>/cards`), seconds before a card without its own `stale_after_s` is marked stale (900), and the most cards shown (24). See [ADDINS.md](ADDINS.md) |
| `ledger.enabled`, `.dir`, `.tools`, `.expected_hosts`, `.max_kb` | Ledger cards, one per tool from its value ledger (off by default; `dir` default `<data>/ledger`; tools `weatherdeck`, `infirmary`, `lodgings`, `seaworthy`, and the old names `doctor`, `harbor`, `preflight` still read; files over `max_kb` 8192 are not read). See [ADDINS.md](ADDINS.md), "Ledger cards" |
| `ledger.write`, `ledger.host` | The host writes its own `weatherdeck.jsonl` from its history, one append a UTC day (off by default; `host` is the label in each line, default an opaque one, and the label of the first write is kept). See [ADDINS.md](ADDINS.md), "Writing the ledger" |
| `limits.*`, `history.*` | Source cap and body size; retention (events 30 days, daily rollups 400); the received log's size and kept files (`received_log_kb` 2048, `received_log_keep` 3) |

## HTTP

Read-only `GET`/`HEAD`, per profile path: the page, `api/view` (merged and redacted view, `ETag`,
gzip), `logo`; plus `/healthz` everywhere (`{ok, version, package {hash, files}, now, instance}`: `version` carries a hash of the page's files, `package` one of the host's own Python and JSON files, so what a host actually runs is readable). The decks (theme-spec section 16) read two more, only while they are open:
`api/log?n=40` (the newest lines of the received log, each with the titles its source showed then; guest and public views
get the counts only) and `api/history?item=<id>[&owner=<source>]` (that item's recorded events, newest first; none in
guest and public views, whose ids are opaque). The only write is `POST /api/ingest`, which is not part
of any profile and is open to whoever holds a source token (or, with no tokens, to loopback).

- Ingest must be sent as `Content-Type: application/json` (`curl -H 'Content-Type: application/json' -d ...`); anything else gets 415.
- With no tokens, ingest is accepted from loopback only, so the demo and local adapters work with zero setup; anything else gets 403.
- Once a token exists, every ingest needs `Authorization: Bearer <token>`. A token is bound to one source id, so a source cannot speak for another. `weatherdeck token new <id>` prints it once. The first token ends the loopback exception, so `weatherdeck token new` says so and names the loopback HTTP sources the received log shows from the last day; a refused push (that 401, or the 403 above) is one `server.log` line per client address per 10 minutes. A token minted by `weatherdeck invite` is refused (401) once its invite expired before a first push from its source was accepted.
- The page sets every feed string with `textContent`, and a strict content security policy (`default-src 'self'`) blocks inline script and style.

## Security

A board is a trusted screen, so nothing that can merely reach it may write to it or read it from a web
page. Three checks run in the host before anything else, on every listener and profile:

- **Host names.** A request is answered only if its `Host` header names this host: `localhost`,
  `127.0.0.1`, `::1`, the address the listener is bound to, the machine's own hostname (and
  `<hostname>.local`), or a name in `hosts.allowed_hosts`. Anything else gets `403`. This is what stops
  DNS rebinding, where a web page re-points its own domain at your host and reads `/api/view`
  through the browser. Reach the board by another name (a VPN name, a reverse proxy's
  name) by listing it, without a port; matching ignores case and the port:

  ```json
  "hosts": { "allowed_hosts": ["board.vpn.example", "board.home.arpa"] }
  ```

  A request with no `Host` header at all (a bare HTTP/1.0 tool) is not a browser and passes. No
  wildcards. The list is re-read with the config, no restart.
- **Origin.** A POST carrying an `Origin` header that is not this host's own (same scheme, name and
  port as its `Host`, so `null` and other ports fail too) gets `403`. Browsers always send `Origin`
  on a cross-site POST; senders such as `curl`, the adapters and the beat send none.
- **Content type.** `POST /api/ingest` needs `Content-Type: application/json`, else `415`. A web page
  can send `text/plain` or form posts to any address without asking first; a JSON post from another
  origin needs a preflight, which this host never grants (it answers `OPTIONS` with `405`).

Each refusal puts one line in `server.log` naming the header and its value, for example
`refused POST /api/ingest from 127.0.0.1: Origin 'http://evil.example' is not this host's own`.
The checks are in addition to tokens, not instead: bind only where the audience is acceptable, create a
token per source and a read token for any profile you expose, and never put the host on the public
internet without TLS and authentication in front. Report a vulnerability privately to the maintainer
rather than in a public issue.

## Pushing to several hosts

A source can feed several hosts at once, because any machine may host a board. An adapter assembles
one feed per cycle and sends it to every enabled host in a one-line-per-host list:

```
# name   transport  target                    credential
home-tv  http       http://host-a:8787        token-file:~/.config/weatherdeck/home-tv.token
laptop   ssh        user@host-b               key:~/.ssh/weatherdeck_host_b
kiosk    local      /path/to/weatherdeck          -
!spare   http       http://host-c:8787        token-file:~/.config/weatherdeck/spare.token
```

- One line per host; a leading `!` switches a host off without deleting it.
- Hosts are independent: separate timeouts, a separate `seq` counter per host (a host that was down shows no fake gaps), separate backoff. A down host is normal: one log line when it goes down, one when it returns, retry with backoff capped at 5 minutes, never delaying the others.
- Each push carries the complete current state; only `events[]` is incremental.
- One credential per host, revocable on that host alone.

`examples/adapter/push_example.py` implements this for `http` and `local`.

### Forced-command SSH (optional transport)

On the host, in `~/.ssh/authorized_keys`, one key per source:

```
restrict,command="/path/to/weatherdeck/bin/weatherdeck --data /path/to/data ingest --source my-source" ssh-ed25519 AAAA... push-my-source
```

`restrict` turns off forwarding and terminals, the forced command ignores whatever the client asks
for, and `--source` pins the id so that key can speak for one source only. The adapter then runs
`ssh -o BatchMode=yes host weatherdeck-ingest < feed.json` (the word is ignored by the forced command, and harmless if the key ever lost it). Exit codes: 0 accepted, 65 rejected (reason on stdout), 70
internal error. Nothing here edits `authorized_keys` for you: `weatherdeck startup authorized-key` only
prints the line. The one thing the client's command can do is `weatherdeck-check` (a read-only health
probe, exit 0 and an `ok` line); anything else is ignored. On Windows OpenSSH an account in the
Administrators group is read from `C:\ProgramData\ssh\administrators_authorized_keys`, not the profile
(see runbook-windows.md).

## What the host costs

The host is a passive server: nothing runs unless a source pushes or a page reads, it keeps its sources' last feeds in a
small database, and it never asks a source anything. So it has no back-off; its budget is the limits in the feed spec (a body
of 256 KiB, strings, list lengths), and the figures below are what it costs.

Measured on 2026-10-10 on one Linux machine under WSL2 (24 threads, Python 3.14, shared with other jobs, 1-minute load 13 to
65 while measuring), a fresh data directory, one source, loopback; CPU from `/proc/<pid>/stat`, wall time from the client:

| What | Measured |
| --- | --- |
| Idle: no viewer, no source (60 s) | 0.01 CPU s, so 0.6 CPU s an hour; 30 MB resident |
| An hour with two sources pushing every 20 s (45 s sampled, no viewer) | 0.05 CPU s, so 4.0 CPU s an hour |
| One push, a 36 KB feed (60 items, 12 machine rows; 100 pushes that each changed something) | wall p50 3.0 ms, p95 3.5 ms, worst 12 ms; 1.1 ms of host CPU |
| One read of `/api/view` (73 KB, 100 reads) | wall p50 1.0 ms, p95 1.4 ms; 0.3 ms of host CPU; 33 MB resident |

A source that backs off (`pace`, feed spec) pushes less often and costs the host proportionally less; the host does nothing
differently for it except say so on the board.

