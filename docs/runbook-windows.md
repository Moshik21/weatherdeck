# Runbook: a Windows host

For an always-on Windows desktop. Native Windows Python, no WSL, no admin rights.

**Install.** Install Python 3.9 to 3.14 (3.8 is not supported) from python.org (per user, no admin). Avoid the Microsoft Store "Python 3": its
`pythonw.exe` is an App Execution Alias that must never be named in a scheduled task, and it redirects
`%LOCALAPPDATA%` (see "Machine beat" below). Unzip
`weatherdeck-<version>.zip` somewhere stable and short, for example `C:\wd` or `C:\Users\<you>\wd` (a long path can
push a scheduled task past the 261-character limit below). In the examples
`weatherdeck` means `bin\weatherdeck.cmd` inside that folder (cmd or PowerShell); `py -3 bin\weatherdeck ...`
works too.

**Start, stop, check.**

```
weatherdeck on          :: starts in the background, prints the URLs
weatherdeck status      :: running or not, URLs, which profile each address serves, who is reporting
weatherdeck off         :: stops it (asks politely, terminates only if it ignores the request)
weatherdeck run --demo  :: try it in the foreground with synthetic data (Ctrl-C stops)
```

The first `on` may show a Windows Firewall prompt for Python: allow it on **Private networks**
only if you want other devices to reach it.

**Start at logon, no admin rights.** `weatherdeck startup install` registers a per-user logon task
("Weatherdeck host") that runs `weatherdeck on` without a console window, and starts the host now **through that
task** (`schtasks /run /tn "Weatherdeck host"`), so the host is Task Scheduler's and not a child of your
session. Start the host through the task whenever you are connected over SSH: a host started from an SSH
session with `weatherdeck on` is a child of that session and stops when it logs off. If Windows refuses the
task for a standard user it says so and writes a small script to your Startup folder instead (the same
effect at logon); there is then no task to start it through, so from an SSH session use `--no-start` and
let it start at the next logon, or start it from a console session. `weatherdeck startup install --config-from FILE` also copies a config in when
there is none (a different existing one is kept; the file is written beside it as `config.json.new`),
`--dry-run` shows what it would do, `weatherdeck startup status` shows what is registered and
`weatherdeck startup remove` undoes it (the running host is stopped with `weatherdeck off`).

**Receiving a feed over SSH.** A machine that pushes with a forced-command key needs one line in the
SSH server's `authorized_keys`: `weatherdeck startup authorized-key --source ID --key "ssh-ed25519 AAAA..."`
prints it (and writes the one-line `ingest-ID.cmd` it points to). Windows OpenSSH reads
`C:\ProgramData\ssh\administrators_authorized_keys` for an account in the Administrators group and
`%USERPROFILE%\.ssh\authorized_keys` for any other; the administrators file must be writable only by
SYSTEM and Administrators. Check with `ssh -i KEY user@host weatherdeck-check` (prints an `ok` line).

**Where things live.** Data, database, logs and tokens are in `%LOCALAPPDATA%\weatherdeck`
(`history.sqlite`, `server.log`, `ingest.log`, `server.out`, `tokens.json`); the config is
`%LOCALAPPDATA%\weatherdeck\config.json` (create it). Use `--data C:\somewhere` or `WEATHERDECK_DATA` to move it.

**Bind addresses** (config `hosts.bind`; default is localhost only; `0.0.0.0` is refused):

```json
{ "hosts": { "port": 8787, "bind": [
    "localhost",
    { "address": "auto:100.64.0.0/10", "profiles": ["full"] },
    { "address": "auto:192.168.1.0/24", "profiles": ["public"] } ] } }
```

Localhost serves everything (kiosk browser on this PC: `http://127.0.0.1:8787/`), a VPN range
serves the full view, the home LAN serves only the redacted public view. Find your LAN range with
`ipconfig`. Restart after changing `bind` or `port`. Default URL shape: `http://<address>:8787/`.

**A config to start from.** `examples\host\config.example.json` (in the zip, and in the repository under `examples/host/`)
is a complete host config with neutral values. Change the two ranges and the machine ids to yours, then
`weatherdeck startup install --config-from examples\host\config.example.json` copies it into place:

| Setting | Value in the example |
| --- | --- |
| `hosts.bind` | `localhost` serves every view (a browser on this PC: `http://127.0.0.1:8787/`); `auto:10.8.0.0/24` (a VPN range) serves the **full** view; `auto:192.168.1.0/24` (the home LAN) serves only the **tv** view at `/` of that address: titles, repo names and pull-request links, but no free text about what a worker is doing, no machine detail, no paths. [Privacy mode](#privacy-mode) turns it into counts only |
| `auto:` ranges | A range with no matching address on this PC is fine: it waits (rechecked every 15 s), so a VPN or LAN that comes up late is handled. Change the range to match `ipconfig` |
| `hosts.allowed_hosts` | Names, beyond the bound addresses, that the host answers to; see [Host names](#host-names) |
| `display.quiet_hours` | 23:00 to 07:30 local; the night palette; sound is off and stays off |
| `display.may_sleep` | `["laptop"]`: machines that may sleep at night, so when their feed stops in quiet hours the board reads "Asleep since 23:41" in grey instead of "Silent". The list is matched against machine ids exactly (a source's `machine`, not its source id and not a host name), so the id here must be the one that machine's feed carries. An existing config keeps its own list: add the id there by hand |
| `machines.aliases` | Folds an id an older install still reports (`my-pc-linux`) into the machine it really is (`my-pc`) as one of its stations (`Linux (WSL)`), so two reporters on one PC show as one machine with two stations |
| `theme` | `ship-deck`; set `theme.name` to `default` for the plain look |

**Tokens.** A new source (anything that pushes feeds) gets its own token:
`weatherdeck token new <source-id>`. It is shown once; give it to that source as
`Authorization: Bearer <token>`. To protect a view: `weatherdeck token new --read public`, then open
`http://<address>:8787/?key=<token>` once on each viewing device.

**Upgrade.** `weatherdeck off`, replace the program folder with the new unzipped one (data and config
live elsewhere and are kept), `weatherdeck startup install` from the new folder (it re-registers the task and
starts the host through it; over SSH this is the way to start it), or `weatherdeck on` from a console session.
Check with `weatherdeck status`.

**Remove.** `weatherdeck startup remove`, `weatherdeck off`, `schtasks /delete /tn weatherdeck-beat /f` if you set up the beat
below, delete the program folder and, if wanted, `%LOCALAPPDATA%\weatherdeck` (the data, history and tokens); remove each
pusher's line from `authorized_keys`.

## Host names

The host answers only to its own names: `localhost`, the addresses it is bound to (so a VPN or LAN address works as it is),
the machine's hostname, and `hosts.allowed_hosts`. To open the board or probe it by a **name** (`http://board.vpn.example:8787/`),
add that name to `"hosts": { "allowed_hosts": ["board.vpn.example"] }` in the config (no restart; the file is re-read). Until
then that name gets `403` and `server.log` says why. An ingest POST must also be `application/json` with no foreign
`Origin`; every shipped sender already does this. See [hosting.md](hosting.md), Security.

## Privacy mode

Privacy mode turns a view marked `"privacy": true` (the `tv` view) into counts only, the same as the `public` view: group and
machine names, states, percent ranges and ages, but no titles, repos or links. `weatherdeck privacy on` and
`weatherdeck privacy off` do it from a console, `weatherdeck privacy` shows the state, and it acts within a few seconds, from
the host, never only in the browser. The marker is the file `privacy.on` in the data directory, so it survives restarts. The
TV's corner says "Privacy mode" while it is on. `localhost` and the full view never change.

For a double-click, save two small files next to `bin\` (here in a folder `shortcuts\`):

```
:: shortcuts\privacy-on.cmd
@echo off
"%~dp0..\bin\weatherdeck.cmd" privacy on
```

and the same with `privacy off` as `privacy-off.cmd`.

## Check the host by hand

Three checks, none of which changes anything; run them from this PC or from any machine that can reach it:

```
curl -fsS http://<host>:8787/healthz                       # the host answers: {"ok":true,"version":...,"now":...}
ssh -i <key> <user>@<host> weatherdeck-check               # the path a pusher takes, with nothing ingested
weatherdeck received --summary                             # on the host: per source and day, pushes, rejections, longest gap
```

- **`/healthz`** is served on every bound address and needs no token. A `403` here means the name in the URL is not one of the
  host's names (see [Host names](#host-names)); use the address, or add the name.
- **`weatherdeck-check`**: a forced-command key answers it with one `ok` line and ingests nothing, so it proves sshd, the key,
  the program and its data directory. `Permission denied (publickey)` means the line is in the wrong `authorized_keys` file for this account
  type (see Troubleshooting).
- **`weatherdeck status`** on the host lists the addresses it serves and who is reporting. A source the board names as "not
  reporting" has never pushed to this host (another source expects it); "silent" means it stopped, with how long ago; a machine
  in `display.may_sleep` reads "Asleep" in quiet hours. Lost contact is only shown when every source is silent past
  `lost_after_s` (15 minutes).

What the board itself says: a source that stops is fogged and named ("Laptop silent 4 min"); a machine that stops during quiet
hours reads "Asleep since 23:41" and its last known lanes stay up, grey and marked LAST KNOWN, never fresh and never red; when
the host itself is unreachable, every screen shows the hailing plate with the age of the newest data it has.

## The received log

Every push that reaches this host, accepted or rejected, is one JSON line in `%LOCALAPPDATA%\weatherdeck\received-log.jsonl`
(rotated at 2 MB, three older files kept): time, source, `seq`, transport, size, the gap since the last `seq`, the count per
section (waiting on you, critical, items by state, next, done, machines) and, whenever they changed since that source's previous
feed, the exact titles.

```
weatherdeck received --tail 20 --diff              :: the newest pushes, with the titles that came, went or changed state
weatherdeck received --source <id> --tail 5 --diff :: one source
weatherdeck received --summary                     :: one line per source and day
```

Compare it with the pusher's own log, if it keeps one: the same `seq`, the same counts. See [hosting.md](hosting.md) for every
option.

## Machine beat (health of this PC)

`bin\weatherdeck-beat` ([beat.md](beat.md)) samples memory, paging, processor queue and disk every 15
seconds. It starts one `typeperf` (part of Windows) and keeps reading its output, so nothing is
started per sample, and it needs no admin rights and installs nothing.

1. **Try it.** `py -3 bin\weatherdeck-beat once` (add `--gpu` if `nvidia-smi` is installed and you want
   it). It prints one beat; `beat.errors` must be empty and `load.runq_per_core`, `mem.avail_gb`,
   `mem.commit_pct` and `mem.paging_pps` must have values. If typeperf rejects its counters (a
   Windows installation that is not in English) the fields stay empty and `errors` says so.
2. **Run it at logon, no admin.** Name the real interpreter, never a bare `pythonw.exe` and never a path under
   `\WindowsApps\` (the Microsoft Store alias). A bare `pythonw.exe` in a task resolves through `PATH`, and on a machine
   with Store Python that is the alias. Under the alias the beat process starts and stays up, looks healthy in Task
   Manager and `schtasks /query` for hours, and delivers nothing: no push reaches the host and nothing says so (seen on
   a Windows PC; the identical command under the real interpreter pushed at once). Find the real path with
   `py -3 -c "import sys; print(sys.executable)"`; it must not contain `\WindowsApps\`. Typical per-user installs
   are `C:\Users\<you>\AppData\Local\Programs\Python\Python312\pythonw.exe` (use the one you have), and
   `pythonw.exe` there has no console window. Either put a shortcut in `shell:startup` whose target is
   `C:\Users\<you>\AppData\Local\Programs\Python\Python312\pythonw.exe C:\wd\bin\weatherdeck-beat run --machine my-pc --label "My PC"`,
   or create a per-user task:

   ```
   schtasks /create /f /tn weatherdeck-beat /sc onlogon /rl limited /tr "C:\Users\<you>\AppData\Local\Programs\Python\Python312\pythonw.exe C:\wd\bin\weatherdeck-beat run --machine my-pc --label \"My PC\""
   ```

   Two limits of `schtasks`:

   - **The `/tr` value is capped at 261 characters.** A longer line is refused (and `startup install` then falls back
     to the Startup folder). The real interpreter path alone is 61 characters plus your user name, so unpack the package under a
     short path such as `C:\wd` and count the line before you register it. For the host, `weatherdeck startup install
     --dry-run` prints `logon task: schtasks /create ... /tr "<cmd>"`; the length that counts is the quoted `<cmd>`
     after `/tr`. For the beat, count the quoted string you are about to give `/tr` (`--push` and `--token-file`
     included).
   - **Never change a task with `schtasks /change /tr`.** For this account it asks for a password, and over ssh that
     is a hang nobody can answer. To repair or move a task, create it again with `/create /f /sc onlogon /rl limited`,
     as `weatherdeck startup install` does; `/f` replaces the old one.

   `schtasks /delete /tn weatherdeck-beat /f` removes it. A second copy exits at once (lock file).
   **Where the files are.** The beat file is `%LOCALAPPDATA%\weatherdeck-beat\beat.json` and a month of daily samples sit
   beside it. Under Store Python that path is not the real one: Windows redirects `%LOCALAPPDATA%` writes of a Store
   Python process into the package's private folder,
   `%LOCALAPPDATA%\Packages\PythonSoftwareFoundation.Python.3.X_qbz5n2kfra8p0\LocalCache\Local\weatherdeck-beat\`
   (`3.X` is the installed minor version, for example `3.12`), and that holds `beat.json`, the history and
   `weatherdeck-beat.log`, the one place the beat writes a push failure (once per outage). Explorer and a plain
   `dir %LOCALAPPDATA%\weatherdeck-beat` do not show it. Pass `--out C:\wd\beat\beat.json` to put the beat file and its
   history where you can see them; the log (written when there is no console, as under `pythonw`) still goes to the
   `weatherdeck-beat` folder of the beat's `%LOCALAPPDATA%`, redirected or not.
   To appear on a Weatherdeck host as a source of its own add
   `--push http://<host>:8787 --token-file %LOCALAPPDATA%\weatherdeck-beat\token` (`weatherdeck token new beat-my-pc`
   on the host; under Store Python, where `%LOCALAPPDATA%` is redirected for that process, keep the token file at a
   plain path in your user profile such as `C:\Users\<you>\beat-token` so there is no doubt which copy the beat reads).
   **A beat on the same host as the dashboard** may push to `http://127.0.0.1:8787` with no token **only while
   the host holds no push tokens at all.** The first `token new <source-id>` for any machine makes the host answer
   every tokenless push with `HTTP 401`, loopback included, and the beat logs that once and then pushes
   nothing, with no sign on the board (a host version that logs refused pushes writes one `refused POST /api/ingest`
   line to `server.log` per 10 minutes; an older one writes nothing). Run `weatherdeck token list`: if it shows any push
   token, run `weatherdeck token new beat-<machine>` and give the beat `--token-file` with it.
3. **Check the cost.** After ten minutes `beat.cost` in the beat file shows `cpu_pct` and `rss_mb`
   (the `typeperf` child is included). Above 0.5% of one core the row turns amber.
4. **Stop.** End the `pythonw` process in Task Manager, or `schtasks /end /tn weatherdeck-beat`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `startup install` says it used the Startup folder | The task was refused without admin rights. That is fine: `weatherdeck startup status` shows the script; it runs at logon. From an SSH session the host is then not started now (`--no-start`); it starts at the next logon. |
| The board is not reachable from the VPN or the LAN | `weatherdeck status` must list that address (a range with no address on this PC is waiting, not failing); check the Firewall rule for Python is on **Private** networks and the network profile is Private, not Public. |
| A pusher says `Permission denied (publickey)` | The line is in the wrong file for this account type (Administrators group: `C:\ProgramData\ssh\administrators_authorized_keys`; any other: `%USERPROFILE%\.ssh\authorized_keys`), or the administrators file's permissions are wrong (writable only by SYSTEM and Administrators). |
| A pusher says `rejected: source id ... does not match` | The key's `--source` and the pusher's `source_id` differ. Run `weatherdeck startup authorized-key --source ID --key "..."` again with the right `--source` and replace that line. |
| A machine reads "Silent", not "Asleep", at night | Its machine id is not in `display.may_sleep` (the id is the `machine` its feed carries, not the source id), or the time is outside quiet hours, or it went silent more than 14 hours ago. |
| Opening or probing the host by a name answers `403` (`Host ... is not one of this host's names`) | Add the name to `hosts.allowed_hosts` in the config (see [Host names](#host-names)); the address form always works. `server.log` names the refused header. |
| A beat pushes nothing and nothing says why | See "Machine beat": a bare `pythonw.exe` that resolves to the Store alias, or a missing `--token-file` once the host holds any push token. |
| The `tv` view shows titles while you want it private | `weatherdeck privacy on`. Check the address is the LAN one: `localhost` and a VPN address serve the full view by design. |
