"""The few things that differ between Windows and POSIX, in one place.

Everything else in the package is platform-neutral. Rules kept here: no fcntl, fork, setsid,
/proc, ps or os.kill(pid, 0) outside a branch for the platform that has it (on Windows os.kill
terminates the process, whatever the signal).
"""
import os
import subprocess
import sys
import time
from contextlib import contextmanager

IS_WIN = os.name == "nt"

if IS_WIN:
    import msvcrt
else:
    import fcntl

# subprocess flags: detach a background child from the console / session
DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_NO_WINDOW = 0x08000000


def background_kwargs():
    """Popen arguments that keep the child running after this command exits."""
    if IS_WIN:
        return {"creationflags": DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW}
    return {"start_new_session": True}


def pid_alive(pid):
    if not isinstance(pid, int) or pid <= 0:
        return False
    if IS_WIN:
        import ctypes
        from ctypes import wintypes
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return ctypes.GetLastError() == 5  # access denied: it exists
        try:
            code = wintypes.DWORD()
            return bool(kernel32.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259  # STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def force_stop(pid):
    """Last resort after a graceful stop request failed."""
    import signal
    os.kill(pid, signal.SIGTERM if IS_WIN else signal.SIGKILL)  # on Windows this is TerminateProcess


def termination_signals():
    import signal
    sigs = [signal.SIGINT, signal.SIGTERM]
    if hasattr(signal, "SIGBREAK"):
        sigs.append(signal.SIGBREAK)
    return sigs


@contextmanager
def file_lock(path):
    """An exclusive lock on a file, held for the with-block (blocks until free)."""
    with open(path, "a+b") as fh:
        if IS_WIN:
            fh.seek(0)
            while True:
                try:
                    msvcrt.locking(fh.fileno(), msvcrt.LK_LOCK, 1)  # retries for ~10 s, then raises
                    break
                except OSError:
                    time.sleep(0.05)
            try:
                yield
            finally:
                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            fcntl.flock(fh, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(fh, fcntl.LOCK_UN)


def replace_file(src, dst):
    """os.replace that survives a reader holding the target open (Windows raises PermissionError)."""
    for attempt in range(40):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if not IS_WIN or attempt == 39:
                raise
            time.sleep(0.05)


def command_output(cmd, timeout=4):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def default_data_dir():
    from pathlib import Path
    home = Path.home()
    if IS_WIN:
        return Path(os.environ.get("LOCALAPPDATA") or home / "AppData" / "Local") / "weatherdeck"
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "weatherdeck"
    xdg = os.environ.get("XDG_DATA_HOME")
    return (Path(xdg) if xdg else home / ".local" / "share") / "weatherdeck"
