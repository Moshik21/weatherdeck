# The machine beat: `bin/weatherdeck-beat`

A machine that is busy or gone looks the same as a healthy one on a board that only shows load
average. `weatherdeck-beat` is a small agent that runs on each machine, samples the signals that do
tell them apart every 15 seconds, and publishes the result as a JSON document any source can copy
into `machines[]`. It can also push itself to a Weatherdeck host as a feed of its own. Python 3.9 to 3.14 (3.8 is not supported),
standard library only, no root, no model calls.

```
weatherdeck-beat run    sample until stopped; write the beat file, the history, optionally push
weatherdeck-beat once   sample for a few seconds, print one beat as JSON, exit
weatherdeck-beat report summarise the history files (percentiles, time in each level)
```

```
python3 bin/weatherdeck-beat run --machine my-mac --label "My Mac" --push http://127.0.0.1:8787 --token-file ~/.config/weatherdeck-beat/token
```

## What it measures, per OS

Load average is deliberately not a deciding signal. On Linux it counts tasks stuck in disk waits
as load, on macOS it counts only runnable threads (swap and disk stalls do not show), it lags by
about a minute, and it is a raw count that means different things on 8 and 24 cores.

| Signal | macOS | Windows | Linux and WSL |
| --- | --- | --- | --- |
| Memory pressure | `kern.memorystatus_vm_pressure_level`, free percentage (`sysctlbyname`) | available memory and commit use (`GlobalMemoryStatusEx`, with typeperf counters as a backup) | memory stall percentage (`/proc/pressure/memory`), `MemAvailable` |
| Swap rate | swap in plus out, pages per second (`host_statistics64`) | `\Memory\Pages/sec` | `pswpin` plus `pswpout` from `/proc/vmstat` |
| Run queue | 1-minute load per performance core (trend only) | `\System\Processor Queue Length` per logical core | runnable tasks from `/proc/loadavg`, per core; CPU stall percentage |
| Disk | the data volume | `C:` | `/`, and in WSL the Windows drive that holds the virtual disk (`df` inside WSL reports the virtual disk, not the drive) |
| Other | compressor size, battery | pagefile use, disk busy, battery, GPU with `--gpu` | I/O stall percentage, battery |

No program is started per sample. macOS reads sysctl and `host_statistics64` through `ctypes`
(battery is read with `pmset` every two minutes). Linux and WSL read `/proc`. Windows starts one
long-lived `typeperf` and keeps reading its output; memory and battery are read in process.
`--gpu` (Windows only, off by default) runs `nvidia-smi` once a minute. The counters are asked for
by their English names, so on a Windows installation in another language typeperf rejects them
and those fields stay empty, with the reason in `beat.errors`.

## The level, and why it says so

Each sample is graded against thresholds (a first cut, listed in `TH` at the top of the file,
overridden with `--set name=warn,crit`): memory stall percentage, available memory, commit use,
swap rate and paging rate (1-minute means), run queue per core (1-minute mean), CPU and I/O stall
percentages, and free disk per volume (`--disk LABEL=PATH:WARN_GB:CRIT_GB`, default 40 and 15 GB).
The level is the worst signal, `ok`, `warn` or `critical`. To keep it from flapping a level is
entered after two samples (30 s) and left only after twenty samples (5 min) below it. `pressure.why`
holds the reasons of the latest sample ("swapping 410 pages/s", "run queue 3.2 per core"), or
"clearing, last cause: ..." while a level is being left. The level is advice for people and for
schedulers. Nothing here kills, pauses or moves work.

Tune the thresholds from data, not from this file: the history (below) is there to do that.

## The beat

`--out` (default `~/.cache/weatherdeck-beat/beat.json`, `~/Library/Caches/weatherdeck-beat/beat.json` on
macOS, `%LOCALAPPDATA%\weatherdeck-beat\beat.json` on Windows, redirected under Store Python: see Pushing) is replaced atomically every sample:

```json
{ "schema": "lookout.beat", "schema_version": "1.0", "host": "my-mac", "os": "macos", "boot_id": "...",
  "seq": 81234, "at": "2026-10-08T21:40:15Z", "at_epoch": 1791495615.2, "interval_s": 15,
  "machine": { "id": "my-mac", "label": "My Mac", "status": "warn", "as_of": "...",
               "load": {...}, "mem": {...}, "io": {...}, "disks": [...], "pressure": {...},
               "beat": {"seq": 81234, "interval_s": 15, "age_s": 0, "cost": {...}, "errors": []} },
  "push": { "state": "refused", "since": "2026-10-08T21:12:45Z", "code": 401,
            "reason": "HTTP 401 a valid bearer token is required" } }
```

`machine` is a complete `machines[]` row (see [feed-spec.md](feed-spec.md)). A source that reads the
file sets `machine.beat.age_s` to the file's age on its own clock before copying the row, which is
what lets the page tell a beat that stopped from one that is merely slow, without trusting any two
clocks to agree. Anything the OS cannot give is `null`, never zero.

`push` is there only when the beat runs with `--push`, and says what the last push did, so a refused or unreachable
host shows where people look and not only in a log. It is the file's own key, not part of `machine`, so a source that
copies `machine` never sees it, and `schema_version` stays 1.0 (a reader that ignores unknown top-level keys, as an adapter
should, is unaffected). `state` is `ok` (the host accepted the beat), `refused` (the host answered 4xx) or `down`
(no answer, or a 5xx); `since` is when the state last changed; `code` is the HTTP status, or `null` when there was no
answer; `reason` is the host's own words in plain text (at most 120 characters of its reply) or the connection error, and
`null` while `ok`. It is rewritten with every sample, in the same sample as the push, so it is never older than the file.

## Staleness

The page applies the source levels to the beat's own interval: live up to 2 intervals (30 s), late
up to 4 (60 s), stale beyond that, lost after `thresholds.lost_after_s` (15 minutes). A late or
stale beat is drawn as last known (dimmed, with "beat N s old"). When the source carrying the row
is still reporting but the beat is lost, the host raises a "lost" card for the machine.

## Cost, measured by the agent itself

`beat.cost` has `cpu_pct` (of one core, over the last 5 minutes), `cpu_pct_total` (since start),
`cpu_s_per_h`, `rss_mb`, `collect_ms` (time spent sampling) and `over_budget`. The budget is 0.5%
of one core; when it is exceeded for a 5-minute window the row shows "beat cost" in amber and the
log says so once. On Windows the child `typeperf` is included where the OS allows it. macOS reports
peak rather than current memory.

**The budgets.** CPU: 0.5% of one core, which is **18 CPU seconds an hour** (`budget_cpu_pct`; `cpu_s_per_h` is the
measured figure to put beside it). Wall time: a sample is a few reads of `/proc` (or one `sysctl`/`vm_stat` pair, or a
line of `typeperf`), so there is no per-run budget to keep beyond the 5 s request timeout of `--push`; `collect_ms` is the
time a sample took. The beat does **not** back off under load or on battery, on purpose: it is what measures the load
(a level is entered after two samples, 30 s), and a stretched sample would make the board's strain words late exactly when
they matter. Its cost is capped by being tiny and reported honestly (`over_budget`); a machine that must save more can be
given a longer `--every` by hand.

**Measured** (2026-10-10, one Linux machine under WSL2 with 24 threads, Python 3.14, shared with other jobs, 1-minute load 10
to 30 with spikes to 190; not a Mac or a Windows PC; a beat writing its file every 15 s for 14 minutes, no push):

| What | Measured |
| --- | --- |
| CPU, the beat's own figure (`beat.cost.cpu_s_per_h`, 5-minute window) | 0.4 to 0.7 CPU s an hour (0.011 to 0.043% of a core) |
| CPU, independent (`/proc/<pid>/stat` after 840 s, start-up included) | 0.32 s, so 1.4 CPU s an hour |
| One sample (`collect_ms`) | 0.4 to 0.6 ms |
| Memory (`rss_mb`) | 8 to 20 MB (it moved to swap while the machine was short of memory) |

Both CPU figures are far under the 18 s budget. The beat's own figure leaves out the interpreter's start-up and exit, which
is why the independent one is higher. A Mac's figure will be higher (it runs `pmset` every two minutes) and is measured the
same way: after ten minutes `beat.cost` in the beat file.

## History and `report`

Unless `--history-dir none`, each sample appends one short line (about 150 bytes, so 1 MB a day) to
`history/beats-YYYYMMDD.jsonl` next to the beat file, UTC days, 30 days kept (`--keep-days`).
`weatherdeck-beat report --hours 336` prints, for the span, the share of samples at each level and
p50/p95/p99/max of run queue, swap rate, memory, stall percentages and the agent's own cost, plus
coverage and gaps. Collect these files from every machine to set thresholds.

## Pushing

`--push URL [--token-file F] [--source ID]` posts the beat to a Weatherdeck host as a source of its
own (default id `beat-<machine>`, `kind: standalone`) every sample; the machine row then appears
on the board with nothing else running there. A host that is down is logged once, then again every hour
while it stays down (with how long it has been down), then once when it returns, and never slows sampling beyond the 5 s
request timeout. What the last push did is also in the beat file's `push` key (see above). Create the token with
`weatherdeck token new beat-<machine>`. `weatherdeck join` ([onboarding.md](onboarding.md)) plans exactly this beat on every machine, beside an adapter pusher
if there is one, as the source `beat-<machine>`; where the pusher and the beat report the same machine id the board shows one machine with two
stations. On Linux a beat registered as a systemd user unit stops when its user's last login session ends unless lingering is on
(`loginctl enable-linger <user>`); `weatherdeck join --dry-run` and `weatherdeck doctor` say so, and `--scheduler cron` is the alternative.
Pointing an adapter at the beat file instead of pushing the beat as its own source remains possible; do not push the same beat file from both.

**A beat on the host's own machine** may push to `http://127.0.0.1:<port>` with no token **only while the host holds
no push tokens.** The first `token new <source-id>` made for any machine makes the host refuse every tokenless push,
loopback included, with `HTTP 401 a valid bearer token is required`; the beat logs that once and goes on sampling
without delivering, and nothing appears on the board. A host that has the refusal logging (`server.log` line
`refused POST /api/ingest from 127.0.0.1: ...`, at most one per address per 10 minutes) names it there; an older host
logs nothing. Run `weatherdeck token list` on the host: if
it shows any push token, run `weatherdeck token new beat-<machine>` and give the beat `--token-file` with it.

**On Windows**, a scheduled task must name the real interpreter (`...\Python312\pythonw.exe`), never a bare
`pythonw.exe` or the Microsoft Store alias (a path under `\WindowsApps\`): under the alias the process looks
healthy for hours and delivers nothing. Under Store Python the files in `%LOCALAPPDATA%\weatherdeck-beat\` really
live under `%LOCALAPPDATA%\Packages\PythonSoftwareFoundation.Python.3.X_qbz5n2kfra8p0\LocalCache\Local\weatherdeck-beat\`,
and so does the log `weatherdeck-beat.log`; pass `--out` at a visible path for the beat file and history. The
task line, `schtasks /create` and its 261-character `/tr` limit, and why to re-create a task rather than
`schtasks /change`, are in [runbook-windows.md](runbook-windows.md).

The pushed source says which part of the machine it measures as `source.station` (`--station TEXT`, default the OS:
`Windows`, `macOS`, `Linux`, or `Linux (WSL)` inside WSL). When another source reports the same `--machine` from
elsewhere (a WSL home on a Windows PC), the board shows one machine with two stations, its pip the worse of them.

## Limits

Written for Python 3.9 to 3.14 on macOS, Windows and Linux. Not collected: other machines (run one beat
per machine; a collector that pulls remote beats is a separate piece), GPU load on anything but
Windows with `--gpu`, thermal state, whether someone is at the keyboard.
