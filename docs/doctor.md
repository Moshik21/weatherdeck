# Checking a machine and a host: `weatherdeck doctor`

`weatherdeck doctor` asks one question on a machine that pushes to a host: **has the host accepted a push from this
source recently, and if not, why not?** `weatherdeck doctor --host` asks the host's side: **what here keeps a source off
the board?** Both are read-only. They print one line per check and end with one overall line.

```
ok    join config: /home/me/.config/weatherdeck/join.json: source beat-laptop -> http://192.0.2.10:8787
ok    service: weatherdeck-beat-beat-laptop.service is registered and running
ok    interpreter: /usr/bin/python3 (a real interpreter, not an alias)
ok    systemd user timers survive logout: lingering is on for me, so the user manager and its units outlive the last login
ok    token file: /home/me/.config/weatherdeck/token is there and not empty (its content is never shown)
ok    token file mode: 0600, private to this user
ok    host: http://192.0.2.10:8787 answers (Weatherdeck 0.9.0-1a2b3c4d)
FAIL  host received: SILENT: the host's last accepted push from beat-laptop was 22 min ago by its own clock, more than 3 intervals (45 s); next: the service and push state lines above say why
FAIL  push state (beat): PUSH_REFUSED: the host refused the beat's pushes since 2026-10-15T14:03:00Z: HTTP 401 a valid bearer token is required; next: the host does not hold this token: ...
ok    clock skew: 0.3 s behind the host's
ok    version: 0.9.0 on both
overall: NOT live: 2 check(s) failed; first: host received SILENT
```

Each line is `ok`, `warn` (a named reason that does not stop delivery), `FAIL` (a named reason and one next step), or
`--` with **`not checked: <why>`** when the check could not be made. A check that could not be made is never `ok`.

## On the machine: `weatherdeck doctor`

It reads the join config that `weatherdeck join` writes (`~/.config/weatherdeck/join.json`, or
`$XDG_CONFIG_HOME/weatherdeck`, on Linux and WSL; `~/Library/Application Support/weatherdeck/join.json` on macOS;
`%USERPROFILE%\.weatherdeck\join.json` on Windows): its `url`, `source`, `token_file`, and when present `interval_s`,
`service`, `beat_file` and `state_file`. A beat set up by hand (see [beat.md](beat.md)) has no join config; give the same
facts on the command line instead:

```
weatherdeck doctor --url http://192.0.2.10:8787 --source beat-laptop --token-file ~/.config/weatherdeck/token
```

Options: `--join-config FILE`, `--url`, `--source`, `--token-file` (each overrides the join config), `--read-token-file`
(a read token, when the host's view needs one), `--pusher-state FILE` (an adapter pusher's state file).

| Check | Named reasons | What it reads |
| --- | --- | --- |
| join config | `NOT_JOINED`, `CONFIG_UNREADABLE`, `CONFIG_INCOMPLETE` | the join config, or the options above |
| service | `SERVICE_NOT_REGISTERED`, `SERVICE_NOT_RUNNING` | Linux: `systemctl --user show weatherdeck-beat-<source>.service`; macOS: `launchctl print gui/<uid>/local.weatherdeck-beat.<source>` and `~/Library/LaunchAgents/<label>.plist`; Windows: `schtasks /query /tn weatherdeck-beat-<source>` (`/xml`, then `/fo list` for its status). The join config's `service` names another |
| systemd user timers survive logout | `LINGER_OFF` (warn) | Linux: `loginctl show-user <user> -p Linger`, and the Weatherdeck user units (`systemctl --user show <service>`, `systemctl --user list-timers`, then `show <timer> --property=NextElapseUSecRealtime` for each Weatherdeck timer, which is the next elapse the line prints). Lingering on: ok. Lingering off with a Weatherdeck user unit or timer registered: warn, with `loginctl enable-linger <user>` as the next step, because the unit stops when the last login session ends and returns only at the next login. Lingering off and no such unit (cron, a system unit): ok. macOS, Windows, and a host whose systemd user manager does not answer: `not checked: not applicable ...`, never ok; so is a lingering state that could not be read. Under WSL (detected as `join --dry-run` does, from `/proc/version`): `not checked: not applicable under WSL ...`, never ok and never a warning; it reports the lingering state when readable and prints no `enable-linger` step, because the user manager's lifetime is bound to WSL itself. Advice only: doctor's repair mode stays off and it never runs `enable-linger` |
| interpreter | `STORE_ALIAS`, `BARE_INTERPRETER`, `INTERPRETER_MISSING` | the program the service starts; on Windows, when the task starts a `.cmd` wrapper, the program on the wrapper's first command line. Any path under `\WindowsApps\` is the Microsoft Store alias or its package: it runs and never delivers |
| token file | `TOKEN_FILE_MISSING`, `TOKEN_FILE_EMPTY`, `TOKEN_FILE_UNREADABLE` | whether the file is there and not empty; the token is never printed |
| token file mode | `TOKEN_FILE_OPEN` | the POSIX mode (anything readable by group or others fails). On Windows: not checked (access is an ACL, which this version does not read) |
| host | `HOST_UNREACHABLE (dns\|refused\|timeout\|error)`, `HOST_NAME_REFUSED`, `HOST_NOT_WEATHERDECK` | `GET /healthz` |
| host received | `NEVER_RECEIVED`, `REJECTED`, `SILENT` | `GET /api/view` (this source's `received_at` and interval) and `GET /api/log` (its newest rejected push and the host's reason), aged on the host's clock from `/healthz`'s `now`. Ok only when the host accepted a push within three of the source's intervals. A view behind a read token is not checked without `--read-token-file` |
| push state (beat) | `PUSH_REFUSED`, `PUSH_DOWN`, `BEAT_STALE` | the beat file's `push` key (beat 1.2 and later; an older beat's file is "not recorded by this version of the beat"). Found at the join config's `beat_file`, else on Windows `%USERPROFILE%\.weatherdeck\state\beat.json`, else the beat's default `--out` |
| push state (pusher) | `PUSH_REFUSED`, `PUSH_REJECTED`, `PUSH_DOWN` | an adapter pusher's state file, `{"source_id", "sinks": {<name>: {"state", "last"}}}`, only when the join config's `state_file` or `--pusher-state` names one; nothing is guessed |
| clock skew | `CLOCK_SKEW` (warn, over 120 s) | this machine's clock against `/healthz`'s `now`. A warning only: the host judges staleness on its own clock, so the board stays right |
| version | `VERSION_SKEW` (warn) | `/healthz`'s `version` and `package` hash against this machine's |

Exit status: 0 only when the host accepted a push from this source within three intervals and no check failed; 1
otherwise, including when the host's receipt could not be checked. Doctor never pushes, never sends the push token
anywhere, and runs only the query commands above.

## On the host: `weatherdeck doctor --host`

It reads the host's data directory (`--data`, as every command) and creates nothing there; the host need not be running.

| Check | Named reasons | What it reads |
| --- | --- | --- |
| invited sources | `INVITED_NEVER_SEEN` | the invite registry, `<data>/invites.json` (written by `weatherdeck invite`): an invite whose source has no accepted push and no `joined_at`, once its time is over, is named with when it was made. One still inside its time is listed as waiting. No registry: "not checked: no invite registry" |
| refused pushes | `REFUSED` | `<data>/rejected/<source>.json` (the host's last rejection per source and its reason) when it is newer than the source's last accepted push, and the `refused POST /api/ingest from <address>` lines of `server.log` from the last day for an address the received log shows no later accepted push from |
| push tokens | `TOKEN_NEVER_USED` (warn) | the names in `tokens.json` (never the hashes) against the sources the host holds a feed for |
| loopback pushers | `LOOPBACK_REFUSED`, `LOOPBACK_AT_RISK` (warn) | the received log's HTTP pushes of the last day and their `client` address. With push tokens on the host, a loopback source with no token of its own is refused now (`LOOPBACK_REFUSED`); with none yet, the first token will have every tokenless loopback pusher refused (`LOOPBACK_AT_RISK`) |

Exit status: 1 when a check failed, or when none could be made; 0 otherwise.

See also [runbook-feed-gap.md](runbook-feed-gap.md): when the board says a machine is silent, the read-only checks that tell a stopped pusher from a machine that is down.

## What still needs a real Mac and Windows PC

The Linux paths run here against real `systemctl --user` answers; the macOS (`launchctl print`, the LaunchAgent plist) and
Windows (`schtasks /query /xml` and `/fo list`, the wrapper script, `\WindowsApps\`) readers run in the tests from injected
answers only. On Windows the task's status is read from the English `Status:` line; on another display language the
service line says so instead of guessing.
