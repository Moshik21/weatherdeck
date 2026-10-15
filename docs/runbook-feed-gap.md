# Runbook: a silent feed versus a machine that is down

A board that shows a machine as SILENT or LOST is saying one thing it measured: **the host has not accepted a push from the
source that reports that machine for N seconds.** It is not saying the machine is off, the program crashed or the network
is cut. Those three look the same from the board and are told apart on the machine, with the read-only checks below, in
this order. Nothing here changes anything; the one remedy named is a single command for the machine's owner.

A common cause on Linux: the pusher is a systemd **user** timer, the user has no login session left, and the user manager
(and the timer with it) exited. The machine is up; its feed is not. A cron pusher on the same machine keeps running, and
the board cannot tell the two apart.

## Before you touch the machine: what the board knows

- **The silent age.** The row says "Silent 6 min" (or LOST past `thresholds.lost_after_s`, 900 s by default). That is the
  host's clock against the source's last accepted push ([honesty.md](honesty.md), [feed-spec.md](feed-spec.md)). It is
  the whole of what the board knows about the gap.
- **The beat's age, when a beat reports this machine.** `machine.beat.age_s` plus the time since receipt says how old the
  last sample was. A beat that kept sampling while pushes were refused shows `push.state` `refused` or `down` in its beat
  file ([beat.md](beat.md)); a beat whose process is gone shows nothing new at all.
- **`weatherdeck doctor` on the machine**, when it has a join config ([doctor.md](doctor.md)): it names `SERVICE_NOT_RUNNING`,
  `HOST_UNREACHABLE`, `REFUSED` or `SILENT` and the one next step. It is read-only. Run it first if you can.

## The checks, in order

Run them on the machine (over ssh is fine). If you cannot get in at all, that is itself a result: see "What each answer
means".

### Linux and WSL

1. **Is the machine up, and since when?** `uptime -s` and `uptime -p`. Compare the boot time with the start of the gap.
2. **Does the user have a manager when nobody is logged in?** `loginctl show-user <user> -p Linger -p State`.
   `Linger=no` with `State=closed` (or no such user listed) means a user timer is not running.
3. **Is the timer scheduled, and when did it last fire?** `systemctl --user list-timers --all`. Look at the LAST and NEXT
   columns of the pusher's timer. "Failed to connect to bus" or an empty list means there is no user manager now.
4. **When did the pusher last run?**
   `journalctl --user -u '<unit>' --since '2 hours ago' --no-pager | tail -n 40` (`<unit>` is the pusher's service name).
   The newest line and the gaps between lines are the evidence. For a **cron** pusher the journal is empty by design: read
   the log the job writes (its crontab line names it, or the pusher's own log under `~/.cache`), and `grep CRON
   /var/log/syslog` or `journalctl -u cron --since '2 hours ago'` for whether cron fired it.
5. **Was the last push accepted?** The pusher's own state or log (for the adapter pusher, `log --tail 5`), or
   `weatherdeck doctor`. This separates "not running" from "running and refused" from "running, host unreachable".
6. **Last, the board's own view:** the silent age and the beat age above, against the times you just found.

### macOS (launchd)

1. `uptime` (and `sysctl -n kern.boottime`).
2. `launchctl print gui/$(id -u)/<label>` for the pusher's LaunchAgent: `state`, `last exit code`, `runs`. A LaunchAgent
   lives in the user's login session, so on a Mac with nobody logged in it is not running either; `who` and
   `stat -f %Sm /dev/console` say who is at the console. `launchctl print` on a label that is not loaded says so.
3. The pusher's log file named in the plist (`StandardErrorPath`, or the pusher's own log): the newest line.
4. `pmset -g log | grep -i -E 'sleep|wake' | tail -n 10`: a Mac that slept for the length of the gap explains it with no
   fault anywhere.

### Windows (scheduled task)

1. `(Get-CimInstance Win32_OperatingSystem).LastBootUpTime` (PowerShell), or `net statistics workstation` and its
   "Statistics since" line.
2. `schtasks /query /tn <task> /fo list /v`: `Status`, `Last Run Time`, `Last Result`, and `Logon Mode`. A task set to run
   only while the user is logged on stops with the session, like the Linux user timer; `Last Run Time` older than the gap
   start says it did not run. (Status text is English only; on another display language read the times.)
3. The pusher's log file: the newest line.

## What each answer means, and what not to conclude

| You find | It means | Do not conclude |
| --- | --- | --- |
| Boot time inside the gap | The machine restarted; the pusher was down until it came back (or has not returned if it starts at logon). | That it crashed: a planned reboot looks identical. |
| Uptime longer than the gap, you can log in | The machine was up the whole time. The fault is the pusher or the path to the host. | That the board was wrong: it was right that the host heard nothing. |
| Linux: `Linger=no`, `State=closed`, empty timer list, journal stops when the last session ended and resumes at the next login | The user timer died with the user manager. The pusher stopped on its own; the machine and the network were fine. | That the machine "went down", or that the timer is broken: it works while a session is open. |
| Timer listed, LAST recent, journal shows runs, board still silent | The pusher runs. Look at what it sends and where: refused (token, source id), unreachable host, a different host in the sinks. `weatherdeck doctor` names which. | That the machine is down. Nor that the host is: other sources may be fine. |
| Timer listed, journal shows runs failing | The pusher is starting and failing; the journal line is the cause. | That nothing is scheduled. |
| Cron: log shows runs through the gap | Cron is fine; the gap is the network or the host. | That the user timer's absence matters: cron does not depend on a session. |
| You cannot reach the machine at all (ssh times out, ping fails from two other places) | Either it is off, or its network is cut. The board cannot say which, and neither can this page. | That it is the pusher. Ask whoever is near it, or check the router or VPN from another machine. |
| macOS slept, or the Windows task is logon-only with no one logged on | Nothing is wrong; nothing was running. List the machine in `display.may_sleep` if this is its normal life ([hosting.md](hosting.md)). | That something failed. |

A gap that ends by itself is not a reason to guess backwards: write down what the checks showed, not what you think
happened.

## The one remedy (Linux, by the machine's owner)

If lingering is off and the pusher is a user timer that should survive with no one logged in:

```
loginctl enable-linger <user>
```

This is a machine-wide setting that belongs to the machine's owner. The installer in a pusher package does not run it, and
neither does anything on this page. A pusher you would rather not tie to a login can instead be a cron line, which needs
no session; WSL without systemd needs its own start, see the pusher package's runbook.

## Does `KillMode=process` matter for a pusher package?

**Short answer: it is a deliberate setting, it is safe, and no change is recommended.** It is about leftover work, not
about duplicate pushes, and it is not related to the feed gap above (the gap came from the user manager exiting, which
stops everything in the user's cgroup whatever `KillMode` says).

What was read (the adapter pusher package's installer, unit template and program, in its own repository), not run:

- **The unit.** The service is `Type=oneshot` with `KillMode=process` and `TimeoutStartSec=60`, started every 20 s by a timer
  (`OnUnitActiveSec=20s`). The comment in the unit gives the reason: a slow reading (a collector that takes tens of
  seconds) refreshes in a detached child with its own hard timeout, and that child must outlive the short push run.
  Under the default `KillMode=control-group`, systemd would kill the child when the oneshot finishes.
- **Does the pusher spawn detached children?** Yes, one kind: a refresher, started with `start_new_session=True` and its
  output and input discarded, one per slow collector. It runs the collector's command with a hard timeout and kills the
  command **and its process group** at the timeout, then writes its answer with an atomic rename and exits. The pusher
  never waits for it; the next run reads the answer it left.
- **Can a stopped timer leave a pusher process running?** A stopped timer starts no new run, and stopping the service
  kills only its main process (that is what `KillMode=process` means). A refresher already running keeps going, in the
  same cgroup, until it finishes or its timeout kills it. `systemctl --user status <unit>.service` shows such a process as
  still in the cgroup, and systemd normally logs that a unit process remains running after the unit stopped. That is the leak
  reported on Linux hosts, and it is bounded by the collector's timeout (tens of seconds in the shipped config).
- **Consequence.** Not duplicate pushes: the refresher never pushes, only writes its cache file. A second refresher for
  the same collector exits at once on a file lock, and two pusher runs for one source are excluded by a single-instance
  lock the refresher does not hold. The consequence is stale readings: for as long as a leftover refresher or a stuck
  collector runs, that collector's cached answer ages, and the board shows the age (it never shows a stale reading as
  fresh). A leftover also costs a little CPU and a process.
- **Where it can still leak.** The process-group kill reaches what the collector's command started in its own group. A
  grandchild that starts its own session (a daemon the command launches) escapes it and, under `KillMode=process`, is left
  by systemd as well. That fits the reports of long-lived children seen after a refresh. This path was read, not
  reproduced.

What was **not** tested: no unit was started, stopped or registered on any machine; no `systemctl` or `loginctl` was run
against a real manager; the leak was not reproduced. The answer above comes from reading the unit template, the installer
and the program.

Recommendation, no change made: keep `KillMode=process` for this design (the alternative kills the refresher on every
tick). If leftovers matter on a host, look with `systemctl --user status <unit>.service` and `ps -eo pid,etimes,args` for
processes older than the timeout; and treat any better fix (running the refresher in its own transient unit so it is
accounted and stoppable, or killing the group on a stop signal) as a change to the pusher package, not to this page.
