# Runbook: a macOS host

For a macOS computer used as a host, or as a standby host next to another. Python 3.9 to 3.14 (3.8 is not supported; the system
`python3` from the Command Line Tools, or python.org, or Homebrew). No root. The same steps work on
Linux.

**Install.** Unzip `weatherdeck-<version>.zip` somewhere stable, for example `~/weatherdeck`. In the
examples `weatherdeck` means `python3 ~/weatherdeck/bin/weatherdeck` (or `~/weatherdeck/bin/weatherdeck` once; the
launcher is executable, and `ln -s` it onto your `PATH` if you like).

**Start, stop, check.**

```
weatherdeck on          # starts in the background, prints the URLs
weatherdeck status      # running or not, URLs, which profile each address serves, who is reporting
weatherdeck off         # stops it (asks politely, terminates only if it ignores the request)
weatherdeck run --demo  # try it in the foreground with synthetic data (Ctrl-C stops)
```

macOS may ask once whether Python may accept incoming connections; allow it if other devices
should reach it. To keep a macOS host awake, set it not to sleep on power (System Settings,
Battery or Energy), or leave this host as standby only.

**Where things live.** `~/Library/Application Support/weatherdeck` holds `history.sqlite`, `server.log`,
`ingest.log`, `server.out`, `tokens.json` and the config `config.json` (create it). Use
`--data DIR` or `WEATHERDECK_DATA` to move it (Linux default: `~/.local/share/weatherdeck`).

**Bind addresses** (config `hosts.bind`; default is localhost only; `0.0.0.0` is refused):

```json
{ "hosts": { "port": 8787, "bind": [
    "localhost",
    { "address": "auto:100.64.0.0/10", "profiles": ["full"] },
    { "address": "auto:192.168.1.0/24", "profiles": ["public"] } ] } }
```

Localhost serves everything (kiosk browser on this computer: `http://127.0.0.1:8787/`), a VPN range
serves the full view, the home LAN serves only the redacted public view. Find your range with
`ifconfig`. Restart after changing `bind` or `port`. Default URL shape: `http://<address>:8787/`.

**Tokens.** A new source gets its own token: `weatherdeck token new <source-id>` (shown once; the source
sends `Authorization: Bearer <token>`). To protect a view: `weatherdeck token new --read public`, then
open `http://<address>:8787/?key=<token>` once on each viewing device.

**Upgrade.** `weatherdeck off`, replace the program folder with the new unzipped one (data and config
live elsewhere and are kept), `weatherdeck on`; check with `weatherdeck status`.

**Linux and WSL.** Run the host under a systemd user service. Save as
`~/.config/systemd/user/weatherdeck.service`, then `systemctl --user enable --now weatherdeck`:

```
[Service]
ExecStart=/usr/bin/python3 %h/weatherdeck/bin/weatherdeck run
Restart=on-failure
[Install]
WantedBy=default.target
```

Stop and restart it with `systemctl --user stop weatherdeck` and `systemctl --user restart weatherdeck`.
See [hosting.md](hosting.md) for `weatherdeck off` and `restart` under a service manager.

## Machine beat (health of this Mac)

`bin/weatherdeck-beat` ([beat.md](beat.md)) samples memory pressure, swap rate, run queue and disk every
15 seconds from one long-lived process, with no program started per sample, and costs a small
fraction of one percent of a core. The memory number that matters on a Mac is pressure, not load.

1. **Try it.** `python3 ~/weatherdeck/bin/weatherdeck-beat once`. It prints one beat; `beat.errors` must be
   empty, and `mem.native_pressure`, `mem.swap_rate_pps` and `load.runq_per_core` must have values
   (the first sample has no rates, so `once` waits for a second). Anything listed in `errors` is
   a signal this Mac could not give; report it before relying on the beat.
2. **Run it supervised** with launchd. Save as `~/Library/LaunchAgents/local.weatherdeck-beat.plist`
   (replace the `/path/to` placeholders and the machine id), then `launchctl load -w` it:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>Label</key><string>local.weatherdeck-beat</string>
     <key>ProgramArguments</key><array>
       <string>/usr/bin/python3</string>
       <string>/path/to/weatherdeck/bin/weatherdeck-beat</string>
       <string>run</string>
       <string>--machine</string><string>my-mac</string>
       <string>--label</string><string>My Mac</string></array>
     <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
     <key>ProcessType</key><string>Background</string>
     <key>LowPriorityBackgroundIO</key><true/>
     <key>Nice</key><integer>10</integer>
     <key>StandardErrorPath</key><string>/path/to/logs/weatherdeck-beat.log</string>
     <key>StandardOutPath</key><string>/dev/null</string>
   </dict></plist>
   ```

   The beat file is `~/Library/Caches/weatherdeck-beat/beat.json` and a month of daily samples sit
   beside it. To push it to a host as a source of its own, add
   `--push http://127.0.0.1:8787 --token-file /path/to/weatherdeck-beat.token` (create the token
   with `weatherdeck token new beat-my-mac`); a source that already reports this Mac's row should read the
   beat file instead.
3. **Check the cost.** After ten minutes, `beat.cost` in the beat file shows `cpu_pct` and `rss_mb`.
   Above 0.5% of one core the row turns amber and the log says so; send the numbers along.
4. **Stop.** `launchctl unload ~/Library/LaunchAgents/local.weatherdeck-beat.plist`.

**Linux and WSL.** The same agent works: `python3 bin/weatherdeck-beat run` under a user service. A
systemd user unit (`~/.config/systemd/user/weatherdeck-beat.service`, then
`systemctl --user enable --now weatherdeck-beat`):

```
[Service]
ExecStart=/usr/bin/python3 %h/weatherdeck/bin/weatherdeck-beat run --machine my-box
Nice=10
Restart=on-failure
[Install]
WantedBy=default.target
```

WSL stops its virtual machine when nothing is using it, which a beat reports as a beat that stopped.
That is true (nothing runs there); the Windows beat is the one that describes the PC.
