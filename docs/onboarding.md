# Adding a machine: `weatherdeck invite` and `weatherdeck join --dry-run`

Two commands, one on each side, and one string carried between them. This version builds the invite and the
preflight: `join --dry-run` checks everything a join needs and writes nothing. Installing the beat as a service, the
first push and the verify line come in later versions; until then, set the beat up by hand as in [beat.md](beat.md).
Every join plans **the beat** (source `beat-<machine>`, [beat.md](beat.md)) on the machine, beside an adapter pusher
if there is one, so every machine that reports has a beat the board can read; the dry run prints that plan.

## On the host: `weatherdeck invite`

```
weatherdeck invite --machine laptop [--source beat-laptop] [--ttl 15m] [--url http://ADDRESS:PORT]
```

- Mints a push token for the source (default `beat-<machine>`, the beat's own default) and prints **one join string**.
  The string is a secret and is shown once; the host keeps only the token's hash in `tokens.json`, as with
  `weatherdeck token new`.
- The address in the string is the first non-loopback address the host listens on (`hosts.bind`), else localhost with
  a note that only this computer can use it. `--url` gives another (a VPN name, say); `invite` warns when that name is
  not one the host answers to (add it to `hosts.allowed_hosts`).
- Refused with `ID_TAKEN`, changing nothing, when the source already has a token or already reports. Inviting a source
  whose invite is still open (no push accepted yet) replaces it: the earlier string stops working.
- **Expiry, enforced by the host.** Until the host accepts a first push from the source, a push with its token is refused
  (HTTP 401, "this invite expired ...") once the TTL is over (default 15 minutes, 1 minute to 7 days). After a first
  accepted push the token is an ordinary source token and never expires. No new route: the check is part of the
  existing `POST /api/ingest`. Withdraw an invite at any time with `weatherdeck token revoke <source>`.

### The join string

```
wdjoin1:<host url>:<source id>:<machine id>:<expiry, Unix seconds>:<token>:<check>
```

`<check>` is the first four hex digits of the SHA-256 of everything between `wdjoin1:` and it, so a paste that lost or
changed a character is refused as `JOIN_STRING_DAMAGED` instead of reaching the host. No message ever repeats the string.

### The invite registry (`<data>/invites.json`)

One small JSON file in the host's data directory, mode 0600, read by the host on each ingest and written only by
`invite`, `token new` and `token revoke` for that source, and the host's first accepted push from an invited source:

```json
{"version": 1, "invites": {"beat-laptop": {"machine": "laptop", "url": "http://192.0.2.10:8787",
  "created_at": "2026-10-15T14:02:00Z", "expires_at": "2026-10-15T14:17:00Z", "joined_at": null}}}
```

- `joined_at` is null until the host accepts a first push from that source, then the time it did.
- No token and no hash are stored here. An entry whose source has no token in `tokens.json` is withdrawn;
  `weatherdeck token revoke <source>` removes the entry too, and `weatherdeck token new <source>` drops it, so a
  token minted by hand for that source never expires.
- A source the host already holds a feed for is never refused by an expired entry.

## On the new machine: `weatherdeck join --dry-run`

```
weatherdeck join --dry-run              # paste the string at the hidden prompt
```

Paste the string at the prompt (or pipe it on stdin) rather than on the command line: a command line shows in the
process list and in shell history. The preflight writes nothing on this machine, and its token probe stores nothing on
the host. Each check prints `ok`, or its name, what it found and one next step; the run exits 1 when any check fails.
`--python PATH` checks another interpreter than the one running the command; `--timeout` sets the wait for the host;
`--scheduler systemd|cron|system` (Linux outside WSL, default `systemd`) names how the beat would be registered; elsewhere
it is ignored and the plan prints a note saying so.

| Name | What it means | Next step it prints |
| --- | --- | --- |
| `JOIN_STRING_DAMAGED` | the string is cut, changed or not a join string | copy it again, or ask for a new invite |
| `PYTHON_TOO_OLD` | the interpreter is older than 3.9 | install Python 3.9 or newer, or pass `--python` |
| `PYTHON_NOT_RUNNABLE` | the `--python` given could not be run | pass the full path of a working interpreter |
| `STORE_ALIAS` | Windows: the interpreter is under `\WindowsApps\` (the Microsoft Store alias or its package); it runs and never delivers | pass `--python` with the real `pythonw.exe` (named when `py -0p` finds one), or install Python from python.org |
| `NO_SERVICE_MANAGER` | no systemd user manager (Linux with `--scheduler systemd`, WSL), launchd (macOS) or Task Scheduler (Windows); with `--scheduler system`, no systemd system manager. `--scheduler cron` needs neither | in WSL, enable systemd; with `--scheduler system`, choose `--scheduler cron`; else run the beat in the foreground |
| `LINGER_OFF` | Linux, `--scheduler systemd`: lingering is off for this user, so the systemd user unit stops when the user's last login session ends and returns only at the next login (the board shows the machine missing in between). A failure: the plan is not ready | `loginctl enable-linger <user>` (run once as that user), or run the dry run again with `--scheduler cron` |
| `LINGER_UNKNOWN` | Linux, `--scheduler systemd`: `loginctl show-user <user> -p Linger` did not answer, so the lingering state is not known; never a pass | run that command, then the remedy above if it says `Linger=no`, or use `--scheduler cron` |
| `NO_CRON` | `--scheduler cron` was chosen and there is no `crontab` command | install cron, or use `--scheduler system` |
| `PUSHER_AT_RISK` | a warning: an adapter's pusher here is a systemd user unit and lingering is not on, so it stops at the last logout whatever the beat uses | `loginctl enable-linger <user>` |
| `CANNOT_WRITE` | the config folder or the state folder cannot be created or written | give this user write access |
| `ALREADY_JOINED` | an earlier beat service, task, crontab line or join on this machine | remove it first (the exact command is printed) |
| `HOST_UNREACHABLE (dns)` | the host's name does not resolve here | check the address; a VPN name needs this machine on the VPN |
| `HOST_UNREACHABLE (refused)` | nothing listens on that address and port | is the host running, and does `hosts.bind` include an address this machine can reach |
| `HOST_UNREACHABLE (timeout)` | no answer in time: a firewall or the network drops it | allow Python on Private networks on a Windows host; check the network |
| `HOST_NAME_REFUSED` | the host answered 403: the name in the string is not one of its names | add it to `hosts.allowed_hosts` on the host, or invite with `--url` |
| `NOT_WEATHERDECK` | something else answers on that port | check the address |
| `HOST_TOO_OLD` | the host does not report its clock on `/healthz` | upgrade the host first |
| `CLOCK_SKEW` | a warning, never a stop: the clocks differ by more than 120 s (the host judges staleness on its own clock) | turn on network time |
| `TOKEN_REFUSED (401)` / `(403)` | the host does not hold this token, or holds no push tokens at all | invite again |
| `INVITE_EXPIRED` | the host refused the token: the invite expired before a first push | invite again |
| `PROBE_FAILED` | the token probe got another answer | `weatherdeck logs` on the host |
| `ID_TAKEN` | the source already reports to the host | the invite was used; ask for one with another `--machine` |
| `ID_UNCHECKED` | a warning: the host's view needs a read token, so the id could not be asked | `weatherdeck status` on the host |
| `MACHINE_ID_DIFFERS` | a warning: this computer already reports under another machine id (inside WSL the beat says `<host>-wsl`, the adapter installers `<host>`) | invite with that `--machine`, so both are stations of one ship |
| `MACHINE_ID_SHARED` | a warning: the machine id is already a ship, and this computer's own name differs | if that ship is another computer, invite with another `--machine` |

**Lingering, and what the join leaves alone.** The lingering check reads `loginctl show-user <user> -p Linger` and nothing else; it
does not run on WSL, nor with `--scheduler systemd` on a host without a systemd user manager, which keep their own findings. `--scheduler cron` plans a crontab line
that starts the beat every minute (the beat holds a lock on its output file, so a second start exits) and `--scheduler system` a
system-level unit running as this user; neither depends on a login session, so lingering is reported and left as found. The join
**never** runs `enable-linger` or `disable-linger`: the plan prints "changed by the join: no", and undoing a join (the `undo` line of the
plan, the removal commands the earlier-install check prints) removes only the beat's own unit or crontab line and leaves lingering exactly
as it found it. If you turned lingering on to join, turning it off again is yours to do (`loginctl disable-linger <user>`), and nothing
in this tool does it.

**The token probe** is `POST /api/ingest` with the token and no body and no `Content-Length`. The host checks the token
before the length, so it answers 411 when the token is good and 401 when it is not, and stores nothing either way (no
received-log line). One limit: on the host's own computer, while the host holds no push tokens at all, every loopback
caller passes, so the probe cannot tell a withdrawn token there.

**Folders.** Config: `~/.config/weatherdeck` (or `$XDG_CONFIG_HOME/weatherdeck`) on Linux and WSL, `~/Library/Application
Support/weatherdeck` on macOS, `%USERPROFILE%\.weatherdeck` on Windows. State: the beat's own folder
(`~/.cache/weatherdeck-beat`, `~/Library/Caches/weatherdeck-beat`) and on Windows `%USERPROFILE%\.weatherdeck\state`,
a folder the Store-Python redirect of `%LOCALAPPDATA%` cannot hide. The check asks the nearest existing folder whether
this user may write there; it creates nothing.

**Checked on Linux only.** The Windows and macOS checks (the Store alias, `py -0p`, `schtasks /query`, `launchctl`) run
here from injected platform facts in the tests; they still need a check on a real Windows PC and Mac.
