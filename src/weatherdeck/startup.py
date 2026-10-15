"""Start the host when its user logs in (Windows, no admin rights), and print the forced-command
`authorized_keys` line for a machine that pushes to this host over SSH.

Nothing here edits anything outside Weatherdeck's own data directory, the current user's Startup
folder and the current user's scheduled tasks. `authorized_keys` is never written: the line is
printed for a person to place.
"""
import os
import re
import subprocess
import sys
from pathlib import Path

from . import config, osx, schema

TASK = "Weatherdeck host"
STARTUP_FILE = "weatherdeck-host.vbs"
KEY_RE = re.compile(r"^(ssh-ed25519) ([A-Za-z0-9+/]{20,}={0,2})(?:\s.*)?$")
ADMIN_SID = "S-1-5-32-544"


def _entry():
    from .cli import ENTRY
    return ENTRY


def _gui_python():
    """pythonw.exe (no console window) next to this interpreter, else the interpreter itself."""
    exe = Path(sys.executable)
    w = exe.with_name("pythonw.exe")
    return str(w) if w.exists() else str(exe)


def host_argv(data, cfg_path):
    return [_gui_python(), str(_entry()), "--data", str(data), "--config", str(cfg_path), "on"]


def cmdline(argv):
    return subprocess.list2cmdline([str(a) for a in argv])


def startup_dir():
    base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    return Path(base) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"


def vbs_text(argv):
    """A Startup-folder script that starts the host with no console window."""
    inner = cmdline(argv).replace('"', '""')
    return ('\' Written by "weatherdeck startup install". Starts the Weatherdeck host at logon, no window.\r\n'
            f'CreateObject("WScript.Shell").Run "{inner}", 0, False\r\n')


def task_args(argv):
    return ["schtasks", "/create", "/tn", TASK, "/sc", "onlogon", "/rl", "limited", "/f", "/tr", cmdline(argv)]


def _run(cmd):
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        return res.returncode, (res.stdout + res.stderr).strip()
    except (OSError, subprocess.SubprocessError) as exc:
        return 127, str(exc)


def _need_windows(args, what):
    if osx.IS_WIN or getattr(args, "for_windows", False):
        return True
    print(f"weatherdeck startup {what} is for a Windows host. On macOS or Linux, start the host from a login item or a "
          f"user service (see docs/runbook-macos.md); add --for-windows to preview what it would do on Windows.")
    return False


def cmd_install(args):
    if not _need_windows(args, "install"):
        return 2
    data, cfg_path = config.data_dir(), config.config_path()
    argv = host_argv(data, cfg_path)
    preview = args.dry_run
    out = (lambda m: print(("[dry run] " if preview else "") + m))
    if args.config_from:
        src = Path(args.config_from).expanduser()
        if not src.is_file():
            print(f"weatherdeck: --config-from {src}: no such file")
            return 2
        want = src.read_bytes()
        if not cfg_path.exists():
            out(f"config: {src} -> {cfg_path}")
            dest = cfg_path
        elif cfg_path.read_bytes() == want:
            out(f"config: {cfg_path} already is this preset")
            dest = None
        else:
            dest = cfg_path.with_name(cfg_path.name + ".new")
            out(f"config: {cfg_path} exists and differs; leaving it and writing {dest} for you to compare")
        if dest is not None and not preview:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(want)
    mode = args.mode
    if mode in ("auto", "task"):
        out("logon task: " + cmdline(task_args(argv)))
        if not preview:
            code, text = _run(task_args(argv))
            if code == 0:
                print(f"registered the per-user logon task {TASK!r} (no admin rights needed)")
                mode = "done"
            elif mode == "task":
                print(f"weatherdeck: could not register the task: {text}")
                return 1
            else:
                print(f"a logon task could not be registered here ({text.splitlines()[-1] if text else code}); "
                      f"using the Startup folder instead")
                mode = "folder"
        else:
            mode = "done"
    if mode == "folder":
        target = startup_dir() / STARTUP_FILE
        out(f"startup folder: write {target}")
        if not preview:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(vbs_text(argv).encode("utf-8"))
            print(f"wrote {target}")
    if args.no_start:
        out("not starting it now (--no-start); it starts at the next logon")
        return 0
    if mode == "done":
        # Started by Task Scheduler, the host is not a child of this session: it keeps running after an SSH logoff.
        out("start now through the logon task: " + cmdline(["schtasks", "/run", "/tn", TASK]))
        if not preview:
            code, text = _run(["schtasks", "/run", "/tn", TASK])
            print(text or "asked Task Scheduler to start it")
            return 0 if code == 0 else 1
        return 0
    # No task (the Startup folder fallback): a host started from here is a child of this session.
    if os.environ.get("SSH_CONNECTION") or os.environ.get("SSH_CLIENT"):
        print("note: this is an SSH session and no logon task could be registered, so a host started now is a child of this "
              "session and stops when it logs off. Use --no-start and let it start at the next logon, or start it from a "
              "console session.")
    out("start now (a child of this session): " + cmdline([sys.executable, str(_entry()), "--data", str(data), "--config", str(cfg_path), "on"]))
    if not preview:
        code, text = _run([sys.executable, str(_entry()), "--data", str(data), "--config", str(cfg_path), "on"])
        print(text)
        return 0 if code == 0 else 1
    return 0


def cmd_remove(args):
    if not _need_windows(args, "remove"):
        return 2
    preview = args.dry_run
    out = (lambda m: print(("[dry run] " if preview else "") + m))
    out(f"delete the logon task {TASK!r} if it exists")
    if not preview:
        code, text = _run(["schtasks", "/delete", "/tn", TASK, "/f"])
        print("removed the logon task" if code == 0 else "no logon task to remove")
    target = startup_dir() / STARTUP_FILE
    out(f"delete {target} if it exists")
    if not preview:
        try:
            target.unlink()
            print(f"deleted {target}")
        except FileNotFoundError:
            pass
    print("the running host is not stopped by this; use: weatherdeck off")
    return 0


def cmd_status(args):
    if not _need_windows(args, "status"):
        return 2
    code, text = _run(["schtasks", "/query", "/tn", TASK])
    print(f"logon task {TASK!r}: " + ("registered" if code == 0 else "none"))
    target = startup_dir() / STARTUP_FILE
    print(f"startup folder script: {target if target.exists() else 'none'}")
    return 0


def _short_path(path):
    """8.3 form on Windows when the path has a space, so a forced command needs no quoting."""
    p = str(path)
    if osx.IS_WIN and " " in p:
        import ctypes
        buf = ctypes.create_unicode_buffer(520)
        if ctypes.windll.kernel32.GetShortPathNameW(p, buf, 520):
            return buf.value
    return p


def _is_admin_account():
    code, text = _run(["whoami", "/groups"])
    return code == 0 and ADMIN_SID in text


def authorized_key_line(source, key, command):
    m = KEY_RE.match(key.strip())
    if not m:
        raise ValueError("--key must be one ssh-ed25519 public key line (the .pub file's content)")
    command = command.replace('"', '\\"')
    return f'restrict,command="{command}" {m.group(1)} {m.group(2)} weatherdeck-push-{source}'


def cmd_authorized_key(args):
    if not schema.ID_RE.match(args.source or ""):
        print("--source: use 1-48 characters from a-z 0-9 . _ - starting with a letter or digit")
        return 2
    windows = osx.IS_WIN or args.for_windows
    data, cfg_path = config.data_dir(), config.config_path()
    ingest = [sys.executable if not args.for_windows else "python.exe", str(_entry()), "--data", str(data), "--config", str(cfg_path),
              "ingest", "--source", args.source]
    if windows:
        wrapper = Path(data) / f"ingest-{args.source}.cmd"
        body = ("@echo off\r\nrem Forced command for the push key of source %s. Written by \"weatherdeck startup authorized-key\".\r\n"
                "%s\r\nexit /b %%ERRORLEVEL%%\r\n") % (args.source, cmdline(ingest))
        if args.for_windows and not osx.IS_WIN:
            print(f"[preview] would write {wrapper}:\n{body}")
        else:
            wrapper.parent.mkdir(parents=True, exist_ok=True)
            wrapper.write_bytes(body.encode("utf-8"))
            print(f"wrote {wrapper}")
        command = _short_path(wrapper)
    else:
        command = cmdline(ingest)
    try:
        line = authorized_key_line(args.source, args.key, command)
    except ValueError as exc:
        print(f"weatherdeck: {exc}")
        return 2
    print()
    print("Add this ONE line to the SSH server's authorized_keys on this machine. Nothing here edits that file:")
    print()
    print(line)
    print()
    if windows:
        admin = args.for_windows or _is_admin_account()
        print("Which file (Windows OpenSSH): an account in the Administrators group is read from")
        print(r"  C:\ProgramData\ssh\administrators_authorized_keys")
        print("and sshd ignores the file in the profile for it; a standard account uses")
        print(r"  %USERPROFILE%\.ssh\authorized_keys")
        if osx.IS_WIN:
            print("This account " + ("IS" if admin else "is not") + " in the Administrators group.")
        print(r"The administrators file must be writable only by SYSTEM and Administrators (one elevated prompt):")
        print(r'  icacls C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"')
    print()
    print(f"The key can only run `ingest --source {args.source}`: it cannot open a shell, forward ports or speak for another source.")
    print("Check it from the pushing machine, which should print an ok line and exit 0:")
    print("  ssh -i <private key> <user>@<this host> weatherdeck-check")
    return 0
