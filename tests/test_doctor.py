"""Acceptance tests for `weatherdeck doctor` and `doctor --host` (unreleased, onboarding slice 10).

    python3 -m unittest discover -s tests

Added under the same deliberate, narrow exception as tests/test_contract.py (CONTRIBUTING.md, "Tests"), for pure core logic only:
each check of `src/weatherdeck/doctor.py` has a fixture that makes it fail with its named reason, and a check that cannot be made
says "not checked", never ok. The OS's answers (a systemd unit, a LaunchAgent, a Windows logon task and its wrapper, a Store-alias
interpreter) are injected through `doctor.Facts`; the host is a real one on a scratch loopback port with a temporary data directory.
Synthetic data only, standard library only; the only files touched are in temporary directories.
"""
import argparse
import json
import os
import socket
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import VERSION, config, doctor, ingest, server  # noqa: E402

SRC = "beat-lab"


def iso(t):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def feed(seq, sid=SRC, at=None):
    return json.dumps({"schema": "lookout.feed", "schema_version": "1.0", "source": {"id": sid, "machine": "lab"}, "interval_s": 15,
                       "generated_at": iso(at or time.time()), "producer": {"boot_id": "beat-1a2b", "seq": seq, "mode": "live"}}).encode()


class Fake(doctor.Facts):
    """A machine whose OS answers are given: `answers` maps the first two words of a query command to (code, output)."""

    def __init__(self, home, os_name="linux", answers=None, skew=0.0, wsl=False):
        super().__init__()
        self.os, self._home, self.answers, self.skew, self.ran, self._wsl = os_name, Path(home), answers or {}, skew, [], wsl

    def home(self):
        return self._home

    def env(self, name):
        return None

    def uid(self):
        return 501

    def now(self):
        return time.time() + self.skew

    def run(self, argv):
        self.ran.append(argv)
        key = " ".join(argv[:2]) if argv[0] != "schtasks" else "schtasks " + argv[-1]
        for n in (4, 3):  # the longest answer given wins: `systemctl --user show <one unit>` over `systemctl --user`
            if " ".join(argv[:n]) in self.answers:
                return self.answers[" ".join(argv[:n])]
        return self.answers.get(key, (127, f"{argv[0]}: not found"))

    def user(self):
        return "synth"

    def wsl(self):
        return self._wsl


def unit(load="loaded", active="active", exe="/usr/bin/python3"):
    return (0, f"LoadState={load}\nActiveState={active}\nSubState=running\n"
               f"ExecStart={{ path={exe} ; argv[]={exe} /opt/wd/bin/weatherdeck-beat run --push http://h --source {SRC} ; }}")


def by_name(checks):
    return {c.name: c for c in checks}


class Temp(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        self.home = self.tmp / "home"
        self.home.mkdir()

    def write(self, rel, text, mode=0o600):
        p = self.tmp / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text if isinstance(text, str) else json.dumps(text))
        os.chmod(p, mode)
        return p

    def join_config(self, url="http://127.0.0.1:9", **extra):
        tok = self.write("home/.weatherdeck-token", "a-token-never-shown\n")
        doc = dict({"url": url, "source": SRC, "token_file": str(tok), "interval_s": 15}, **extra)
        return self.write("home/.config/weatherdeck/join.json", doc)


class Host(Temp):
    """A real host on a scratch loopback port, with its own temporary data directory."""

    def setUp(self):
        super().setUp()
        saved = dict(config._state)
        self.addCleanup(config._state.update, saved)
        self.data = self.tmp / "data"
        config.init(data_dir=str(self.data), config_path=str(self.data / "config.json"))
        config.data_dir()
        srv = server.Listener(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        self.url = f"http://127.0.0.1:{srv.server_address[1]}"

    def doctor(self, facts=None, **kw):
        facts = facts or Fake(self.home, answers={"systemctl --user": unit()})
        return by_name(doctor.machine_checks(facts, **kw))


# ---- the machine side ----------------------------------------------------------------------------
class JoinConfig(Temp):
    def test_no_join_config_is_not_joined_and_nothing_else_is_checked(self):
        checks = doctor.machine_checks(Fake(self.home))
        self.assertEqual((checks[0].verdict, checks[0].reason), (doctor.FAIL, "NOT_JOINED"))
        self.assertTrue(all(c.verdict == doctor.SKIP for c in checks[1:]))
        self.assertEqual(doctor.machine_overall(checks)[1], 1)

    def test_a_config_that_is_not_json_is_unreadable(self):
        self.write("home/.config/weatherdeck/join.json", "{nope")
        self.assertEqual(doctor.machine_checks(Fake(self.home))[0].reason, "CONFIG_UNREADABLE")

    def test_a_config_without_a_source_is_incomplete(self):
        self.write("home/.config/weatherdeck/join.json", {"url": "http://127.0.0.1:9"})
        self.assertEqual(doctor.machine_checks(Fake(self.home))[0].reason, "CONFIG_INCOMPLETE")

    def test_the_per_os_config_paths(self):
        self.assertEqual(doctor.join_config_path(Fake(self.home, "windows")), self.home / ".weatherdeck" / "join.json")
        self.assertEqual(doctor.join_config_path(Fake(self.home, "darwin")),
                         self.home / "Library" / "Application Support" / "weatherdeck" / "join.json")


class Service(Temp):
    def target(self):
        return {"source": SRC, "service": None}

    def test_linux_unit_not_found_is_not_registered(self):
        c, _ = doctor.check_service(Fake(self.home, answers={"systemctl --user": unit(load="not-found", active="inactive")}), self.target())
        self.assertEqual(c.reason, "SERVICE_NOT_REGISTERED")
        self.assertIn(f"weatherdeck-beat-{SRC}.service", c.text)

    def test_linux_inactive_unit_is_not_running(self):
        c, _ = doctor.check_service(Fake(self.home, answers={"systemctl --user": unit(active="failed")}), self.target())
        self.assertEqual(c.reason, "SERVICE_NOT_RUNNING")

    def test_no_user_bus_is_not_checked(self):
        c, st = doctor.check_service(Fake(self.home, answers={"systemctl --user": (1, "Failed to connect to bus")}), self.target())
        self.assertEqual(c.verdict, doctor.SKIP)
        self.assertEqual(doctor.check_interpreter(Fake(self.home), st).verdict, doctor.SKIP)

    def test_macos_no_launch_agent_is_not_registered(self):
        c, _ = doctor.check_service(Fake(self.home, "darwin", {"launchctl print": (113, "Could not find service")}), self.target())
        self.assertEqual(c.reason, "SERVICE_NOT_REGISTERED")

    def test_macos_agent_not_running_names_its_interpreter(self):
        import plistlib
        p = self.home / "Library" / "LaunchAgents" / f"local.weatherdeck-beat.{SRC}.plist"
        p.parent.mkdir(parents=True)
        p.write_bytes(plistlib.dumps({"Label": p.stem, "ProgramArguments": ["/no/such/python3", "beat", "run"]}))
        facts = Fake(self.home, "darwin", {"launchctl print": (0, "\tstate = not running\n")})
        c, st = doctor.check_service(facts, self.target())
        self.assertEqual(c.reason, "SERVICE_NOT_RUNNING")
        self.assertEqual(doctor.check_interpreter(facts, st).reason, "INTERPRETER_MISSING")

    def test_windows_no_task_is_not_registered(self):
        c, _ = doctor.check_service(Fake(self.home, "windows", {"schtasks /xml": (1, "ERROR: The system cannot find the file specified.")}),
                                    self.target())
        self.assertEqual(c.reason, "SERVICE_NOT_REGISTERED")

    def windows(self, wrapper_line, status="Running"):
        wrapper = self.write("home/.weatherdeck/run-beat-lab.cmd", f"@echo off\r\nrem written by join\r\n{wrapper_line}\r\n")
        xml = f"<Task><Actions><Exec><Command>{wrapper}</Command></Exec></Actions></Task>"
        facts = Fake(self.home, "windows", {"schtasks /xml": (0, xml), "schtasks list": (0, f"TaskName: \\weatherdeck-beat-{SRC}\nStatus: {status}\n")})
        return facts, doctor.check_service(facts, self.target())

    def test_windows_store_alias_through_the_wrapper(self):
        facts, (c, st) = self.windows(r'"C:\Program Files\WindowsApps\PythonSoftwareFoundation.Python.3.12_qbz5n2kfra8p0\pythonw.exe" C:\wd\bin\weatherdeck-beat run')
        self.assertEqual(c.verdict, doctor.OK)
        self.assertEqual(doctor.check_interpreter(facts, st).reason, "STORE_ALIAS")

    def test_windows_bare_pythonw(self):
        facts, (c, st) = self.windows(r"pythonw.exe C:\wd\bin\weatherdeck-beat run")
        self.assertEqual(doctor.check_interpreter(facts, st).reason, "BARE_INTERPRETER")

    def test_windows_task_that_is_ready_is_not_running(self):
        _, (c, _) = self.windows(r'"C:\Python312\pythonw.exe" C:\wd\bin\weatherdeck-beat run', status="Ready")
        self.assertEqual(c.reason, "SERVICE_NOT_RUNNING")

    def test_a_real_interpreter_is_ok(self):
        facts = Fake(self.home, answers={"systemctl --user": unit(exe=sys.executable)})
        c, st = doctor.check_service(facts, self.target())
        self.assertEqual((c.verdict, doctor.check_interpreter(facts, st).verdict), (doctor.OK, doctor.OK))

    def test_a_bare_name_on_posix(self):
        facts = Fake(self.home, answers={"systemctl --user": unit(exe="python3")})
        self.assertEqual(doctor.check_interpreter(facts, doctor.check_service(facts, self.target())[1]).reason, "BARE_INTERPRETER")


class Linger(Temp):
    """`systemd user timers survive logout`: advice only, from shimmed systemctl and loginctl answers."""
    TIMER = (0, "Thu 2026-10-15 12:00:20 UTC 12s left Thu 2026-10-15 12:00:00 UTC 8s ago weatherdeck-adapter-synth.timer weatherdeck-adapter-synth.service\n"
                "Fri 2026-10-16 00:00:00 UTC 12h left n/a n/a unrelated.timer unrelated.service")

    def check(self, os_name="linux", linger="no", timers=None, unit_answer=None, wsl=False, **kw):
        answers = {"systemctl --user": unit_answer or unit(), "loginctl show-user": (0, f"Linger={linger}\n"),
                   "systemctl --user list-timers": timers or (0, ""),
                   "systemctl --user show weatherdeck-adapter-synth.timer": (0, "NextElapseUSecRealtime=Thu 2026-10-15 12:00:20 UTC")}
        answers.update(kw)
        facts = Fake(self.home, os_name, answers, wsl=wsl)
        t = {"source": SRC, "service": None}
        c = doctor.check_linger(facts, t, doctor.service_state(facts, doctor.service_name(os_name, SRC)))
        return c, facts

    def test_off_warns_with_the_one_line_remedy_and_never_runs_it(self):
        c, facts = self.check()
        self.assertEqual((c.name, c.verdict, c.reason), ("systemd user timers survive logout", doctor.WARN, "LINGER_OFF"))
        self.assertIn("loginctl enable-linger synth", c.next_step)
        self.assertFalse(any("enable-linger" in " ".join(a) for a in facts.ran))

    def test_on_passes_and_reports_the_next_elapse_of_a_weatherdeck_timer(self):
        c, _ = self.check(linger="yes", timers=self.TIMER)
        self.assertEqual(c.verdict, doctor.OK)
        self.assertIn("weatherdeck-adapter-synth.timer next elapses Thu 2026-10-15 12:00:20 UTC", c.text)
        self.assertNotIn("unrelated", c.text)

    def test_off_with_a_timer_names_it(self):
        c, _ = self.check(timers=self.TIMER)
        self.assertEqual(c.reason, "LINGER_OFF")
        self.assertIn("weatherdeck-adapter-synth.timer", c.text)

    def test_off_but_no_user_unit_is_not_a_loss_at_logout(self):
        c, _ = self.check(unit_answer=unit(load="not-found", active="inactive"))
        self.assertEqual(c.verdict, doctor.OK)
        self.assertIn("no Weatherdeck systemd user unit", c.text)

    def test_not_applicable_hosts_say_so_and_are_never_ok(self):
        for os_name in ("darwin", "windows"):
            c, _ = self.check(os_name)
            self.assertEqual((c.verdict, c.name), (doctor.SKIP, "systemd user timers survive logout"))
            self.assertIn("not applicable", c.text)
        c, _ = self.check(unit_answer=(1, "Failed to connect to bus"))
        self.assertEqual(c.verdict, doctor.SKIP)
        c, _ = self.check(**{"loginctl show-user": (1, "Failed to get user: not logged in")})
        self.assertEqual(c.verdict, doctor.SKIP)

    def test_under_wsl_it_reports_the_state_but_never_warns_or_advises_enable_linger(self):
        for linger, state in (("no", "lingering is off for synth"), ("yes", "lingering is on for synth")):
            c, facts = self.check(linger=linger, timers=self.TIMER, wsl=True)
            self.assertEqual((c.verdict, c.reason, c.next_step), (doctor.SKIP, None, None))
            self.assertIn(state, c.text)
            self.assertIn("bound to WSL itself", c.text)
            self.assertNotIn("enable-linger", c.line())
            self.assertFalse(any("enable-linger" in " ".join(a) for a in facts.ran))
        c, _ = self.check(wsl=True, **{"loginctl show-user": (1, "Failed to get user: not logged in")})
        self.assertEqual(c.verdict, doctor.SKIP)
        self.assertIn("could not be read", c.text)

    def test_it_sits_in_the_machine_checks_and_a_warning_does_not_fail_the_run(self):
        self.join_config()
        facts = Fake(self.home, answers={"systemctl --user": unit(), "loginctl show-user": (0, "Linger=no\n")})
        checks = by_name(doctor.machine_checks(facts))
        self.assertEqual(checks["systemd user timers survive logout"].reason, "LINGER_OFF")


class TokenFile(Temp):
    def test_missing(self):
        c, m = doctor.check_token_file(Fake(self.home), {"token_file": str(self.tmp / "nope")})
        self.assertEqual((c.reason, m.verdict), ("TOKEN_FILE_MISSING", doctor.SKIP))

    def test_empty(self):
        c, _ = doctor.check_token_file(Fake(self.home), {"token_file": str(self.write("t", "  \n"))})
        self.assertEqual(c.reason, "TOKEN_FILE_EMPTY")

    @unittest.skipIf(os.name == "nt", "POSIX file modes")
    def test_readable_by_others_is_open_and_the_token_is_never_shown(self):
        c, m = doctor.check_token_file(Fake(self.home), {"token_file": str(self.write("t", "sekrit-token", 0o644))})
        self.assertEqual((c.verdict, m.reason), (doctor.OK, "TOKEN_FILE_OPEN"))
        self.assertNotIn("sekrit", c.line() + m.line())

    def test_windows_mode_is_not_checked(self):
        _, m = doctor.check_token_file(Fake(self.home, "windows"), {"token_file": str(self.write("t", "x"))})
        self.assertEqual(m.verdict, doctor.SKIP)

    @unittest.skipIf(os.name == "nt" or os.geteuid() == 0, "POSIX file modes, as a user root does not bypass")
    def test_unreadable(self):
        c, _ = doctor.check_token_file(Fake(self.home), {"token_file": str(self.write("t", "x", 0o000))})
        self.assertEqual(c.reason, "TOKEN_FILE_UNREADABLE")


class BeatAndPusherState(Temp):
    def target(self):
        return {"source": SRC, "beat_file": None, "state_file": None, "interval_s": 15}

    def beat(self, push=None, age=0, version="1.2"):
        doc = {"schema": "lookout.beat", "at_epoch": time.time() - age, "interval_s": 15, "machine": {"beat": {"version": version}}}
        if push:
            doc["push"] = push
        self.write("home/.cache/weatherdeck-beat/beat.json", doc)

    def test_refused_beat(self):
        self.beat({"state": "refused", "since": "2026-10-15T12:00:00Z", "code": 401, "reason": "HTTP 401 a valid bearer token is required"})
        c, _ = doctor.check_beat_push(Fake(self.home), self.target())
        self.assertEqual(c.reason, "PUSH_REFUSED")
        self.assertIn("token new", c.next_step)

    def test_down_beat(self):
        self.beat({"state": "down", "since": "2026-10-15T12:00:00Z", "code": None, "reason": "unreachable: timed out"})
        self.assertEqual(doctor.check_beat_push(Fake(self.home), self.target())[0].reason, "PUSH_DOWN")

    def test_stale_beat_file(self):
        self.beat({"state": "ok"}, age=3600)
        self.assertEqual(doctor.check_beat_push(Fake(self.home), self.target())[0].reason, "BEAT_STALE")

    def test_an_older_beat_did_not_record_it(self):
        self.beat(version="1.1")
        c, _ = doctor.check_beat_push(Fake(self.home), self.target())
        self.assertEqual(c.verdict, doctor.SKIP)
        self.assertIn("not recorded by this version", c.text)

    def test_windows_reads_the_beat_file_in_the_join_state_folder(self):
        self.write("home/.weatherdeck/state/beat.json", {"at_epoch": time.time(), "interval_s": 15,
                                                         "push": {"state": "refused", "code": 401, "reason": "HTTP 401"}})
        c, path = doctor.check_beat_push(Fake(self.home, "windows"), self.target())
        self.assertEqual((c.reason, path), ("PUSH_REFUSED", self.home / ".weatherdeck" / "state" / "beat.json"))

    def test_pusher_sink_refused(self):
        state = self.write(f"home/.cache/pusher/{SRC}.state.json", {"v": 2, "source_id": SRC, "sinks": {
            "tower": {"seq": 3, "state": "refused", "backoff": 80, "next": 0, "last": "Permission denied (publickey)."}}})
        self.assertEqual(doctor.check_pusher_push(Fake(self.home), dict(self.target(), state_file=str(state)))[0].reason, "PUSH_REFUSED")
        self.assertEqual(doctor.check_pusher_push(Fake(self.home), self.target()), (None, None))   # no file named: nothing guessed

    def test_pusher_sink_rejected(self):
        state = self.write(f"home/.cache/pusher/{SRC}.state.json", {"v": 2, "source_id": SRC, "sinks": {
            "tower": {"seq": 3, "state": "rejected", "backoff": 0, "next": 0, "last": "replay: seq 3 is not above 9"}}})
        self.assertEqual(doctor.check_pusher_push(Fake(self.home), dict(self.target(), state_file=str(state)))[0].reason, "PUSH_REJECTED")

    def test_neither_record_is_not_checked(self):
        checks = by_name(doctor.machine_checks(Fake(self.home), url="http://127.0.0.1:9", source=SRC))
        self.assertEqual(checks["push state"].verdict, doctor.SKIP)


class HostAnswers(Temp):
    def facts(self, status, body, skew=0.0):
        f = Fake(self.home, skew=skew)
        f.get = lambda url, token=None, timeout=5: (status, body if isinstance(body, bytes) else json.dumps(body).encode(), None)
        return f

    def test_unreachable_port(self):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        c, health, _ = doctor.check_host(doctor.Facts(), {"url": f"http://127.0.0.1:{port}"})
        self.assertEqual((c.reason, health), ("HOST_UNREACHABLE (refused)", None))

    def test_host_name_refused(self):
        c, _, _ = doctor.check_host(self.facts(403, b"Host 'lab.example' is not one of this host's names"), {"url": "http://h"})
        self.assertEqual(c.reason, "HOST_NAME_REFUSED")

    def test_not_a_weatherdeck_host(self):
        self.assertEqual(doctor.check_host(self.facts(200, b"<html>"), {"url": "http://h"})[0].reason, "HOST_NOT_WEATHERDECK")

    def test_clock_skew_warns_over_two_minutes(self):
        self.assertEqual(doctor.check_skew({"now": time.time()}, time.time() + 3 * 3600).reason, "CLOCK_SKEW")
        self.assertEqual(doctor.check_skew({"now": time.time()}, time.time() + 1).verdict, doctor.OK)
        self.assertEqual(doctor.check_skew(None, None).verdict, doctor.SKIP)

    def test_version_skew(self):
        self.assertEqual(doctor.check_version({"version": "0.0.1-abcdef12"}).reason, "VERSION_SKEW")
        self.assertEqual(doctor.check_version({"version": f"{VERSION}-abcdef12", "package": {"hash": "00000000"}}).reason, "VERSION_SKEW")
        self.assertEqual(doctor.check_version({"ok": True}).verdict, doctor.SKIP)


class Received(Host):
    def test_live_after_an_accepted_push(self):
        self.assertEqual(ingest.ingest(feed(1), transport="http").code, ingest.OK)
        cfg = self.join_config(self.url)
        checks = doctor.machine_checks(Fake(self.home, answers={"systemctl --user": unit(exe=sys.executable)}), join_config=str(cfg))
        line, code = doctor.machine_overall(checks)
        self.assertEqual(by_name(checks)["host received"].verdict, doctor.OK, line)
        self.assertEqual(by_name(checks)["version"].verdict, doctor.OK)
        self.assertEqual(code, 0, line)
        self.assertTrue(line.startswith("overall: live"))

    def test_never_received(self):
        self.join_config(self.url)
        self.assertEqual(self.doctor()["host received"].reason, "NEVER_RECEIVED")

    def test_rejected_push_is_named_with_the_hosts_reason(self):
        ingest.ingest(json.dumps({"schema": "lookout.feed", "schema_version": "1.0", "source": {"id": SRC}, "items": "nope"}).encode(),
                      transport="http")
        self.join_config(self.url)
        c = self.doctor()["host received"]
        self.assertEqual(c.reason, "REJECTED")
        self.assertIn("items", c.text)

    def test_a_rejection_after_the_last_accepted_push_is_named(self):
        ingest.ingest(feed(5), transport="http", received_at=time.time() - 10)
        self.assertEqual(ingest.ingest(feed(5), transport="http").code, ingest.REJECTED)   # a replayed seq
        self.join_config(self.url)
        c = self.doctor()["host received"]
        self.assertEqual(c.reason, "REJECTED")
        self.assertIn("since then it rejected one: replay", c.text)

    def test_silent_by_the_hosts_clock(self):
        ingest.ingest(feed(1, at=time.time() - 3600), transport="http", received_at=time.time() - 3600)
        self.join_config(self.url)
        checks = self.doctor()
        self.assertEqual(checks["host received"].reason, "SILENT")
        self.assertEqual(doctor.machine_overall(list(checks.values()))[1], 1)

    def test_a_view_behind_a_read_token_is_not_checked_without_one(self):
        (self.data / "tokens.json").write_text(json.dumps({"read": {"full": "0" * 64}}))
        self.join_config(self.url)
        c = self.doctor()["host received"]
        self.assertEqual(c.verdict, doctor.SKIP)
        self.assertIn("read token", c.text)

    def test_clock_skew_against_a_real_host(self):
        ingest.ingest(feed(1), transport="http")
        self.join_config(self.url)
        checks = self.doctor(Fake(self.home, answers={"systemctl --user": unit()}, skew=3 * 3600))
        self.assertEqual(checks["clock skew"].reason, "CLOCK_SKEW")
        self.assertEqual(checks["host received"].verdict, doctor.OK)   # the host's clock decides, not this machine's

    def test_the_cli_prints_one_line_per_check_and_an_overall_line(self):
        self.join_config(self.url)
        out = []
        args = argparse.Namespace(host=False, join_config=None, url=None, source=None, token_file=None, read_token_file=None, pusher_state=None)
        code = doctor.run(args, Fake(self.home, answers={"systemctl --user": unit()}), out.append)
        self.assertEqual(code, 1)
        self.assertTrue(out[-1].startswith("overall: NOT live"))
        self.assertTrue(any(line.startswith("FAIL  host received: NEVER_RECEIVED") for line in out))
        self.assertNotIn("a-token-never-shown", "\n".join(out))


# ---- the host side -----------------------------------------------------------------------------------
class HostSide(Temp):
    def setUp(self):
        super().setUp()
        saved = dict(config._state)
        self.addCleanup(config._state.update, saved)
        self.data = self.tmp / "data"
        self.data.mkdir()
        config.init(data_dir=str(self.data), config_path=str(self.data / "config.json"))
        self.now = time.time()

    def put(self, rel, doc):
        p = self.data / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(doc if isinstance(doc, str) else json.dumps(doc))

    def accepted(self, sid, at=None):
        self.put(f"sources/{sid}.json", {"received_at": at or self.now, "feed": {}})

    def received(self, *lines):
        self.put("received-log.jsonl", "".join(json.dumps(d) + "\n" for d in lines))

    def checks(self):
        return by_name(doctor.host_checks(self.now))

    def test_no_invite_registry_is_said(self):
        c = self.checks()["invited sources"]
        self.assertEqual(c.verdict, doctor.SKIP)
        self.assertIn("no invite registry", c.text)

    def test_invited_and_never_seen(self):
        self.accepted("beat-old")
        self.put("invites.json", {"version": 1, "invites": {
            "beat-laptop": {"machine": "laptop", "created_at": iso(self.now - 7200), "expires_at": iso(self.now - 6300), "joined_at": None},
            "beat-old": {"created_at": iso(self.now - 9000), "expires_at": iso(self.now - 8100), "joined_at": None},
            "beat-joined": {"created_at": iso(self.now - 9000), "expires_at": iso(self.now - 8100), "joined_at": iso(self.now - 8500)},
            "beat-new": {"created_at": iso(self.now - 60), "expires_at": iso(self.now + 840), "joined_at": None}}})
        c = self.checks()["invited sources"]
        self.assertEqual(c.reason, "INVITED_NEVER_SEEN")
        self.assertIn("beat-laptop (invited ", c.text)
        self.assertNotIn("beat-old", c.text)
        self.assertNotIn("beat-joined", c.text)
        self.assertIn("still within the invite's time: beat-new", c.text)

    def test_a_rejected_source_with_no_later_accept(self):
        self.accepted("beat-a", self.now - 600)
        self.put("rejected/beat-a.json", {"since": self.now - 300, "last_at": self.now - 300, "count": 2, "reason": "replay: seq 4 is not above 9"})
        self.put("rejected/beat-b.json", {"since": self.now - 900, "last_at": self.now - 900, "count": 1, "reason": "old"})
        self.accepted("beat-b", self.now - 100)
        c = self.checks()["refused pushes"]
        self.assertEqual(c.reason, "REFUSED")
        self.assertIn("beat-a: replay", c.text)
        self.assertNotIn("beat-b", c.text)

    def test_a_refused_address_in_server_log(self):
        stamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(self.now - 120))
        self.put("server.log", f"{stamp},101 WARNING weatherdeck.server: refused POST /api/ingest from 192.0.2.7: "
                               "a valid bearer token is required (no Authorization header)\n")
        c = self.checks()["refused pushes"]
        self.assertEqual(c.reason, "REFUSED")
        self.assertIn("from 192.0.2.7: a valid bearer token is required", c.text)

    def test_no_server_log_is_not_checked(self):
        with mock.patch.object(server, "note_refusal", create=True, new=lambda *a, **k: None):
            self.assertEqual(self.checks()["refused pushes"].verdict, doctor.SKIP)

    def test_ok_only_when_this_host_version_records_refused_tokens(self):
        self.put("server.log", "")
        with mock.patch.object(server, "note_refusal", create=True, new=lambda *a, **k: None):
            self.assertEqual(self.checks()["refused pushes"].verdict, doctor.OK)
        with mock.patch.object(doctor, "server", types.SimpleNamespace()):
            c = self.checks()["refused pushes"]
        self.assertEqual(c.verdict, doctor.SKIP)
        self.assertIn("does not record a push refused for its token", c.text)

    def test_a_token_never_used(self):
        self.accepted("beat-a")
        self.put("tokens.json", {"tokens": {"beat-a": "0" * 64, "beat-gone": "1" * 64}})
        c = self.checks()["push tokens"]
        self.assertEqual(c.reason, "TOKEN_NEVER_USED")
        self.assertIn("never used for an accepted push: beat-gone", c.text)

    def line(self, sid, client, result="ok"):
        return {"v": 1, "at": iso(self.now - 300), "source": sid, "transport": "http", "result": result, "client": client}

    def test_loopback_pusher_without_a_token_is_refused_once_tokens_exist(self):
        self.put("tokens.json", {"tokens": {"beat-lab": "0" * 64}})
        self.received(self.line("beat-tower", "127.0.0.1"), self.line("beat-lab", "127.0.0.1"), self.line("beat-far", "192.0.2.9"))
        c = self.checks()["loopback pushers"]
        self.assertEqual(c.reason, "LOOPBACK_REFUSED")
        self.assertIn("beat-tower", c.text)
        self.assertNotIn("beat-lab", c.text)
        self.assertNotIn("beat-far", c.text)

    def test_loopback_pushers_at_risk_before_the_first_token(self):
        self.received(self.line("beat-tower", "::1"))
        self.assertEqual(self.checks()["loopback pushers"].reason, "LOOPBACK_AT_RISK")

    def test_a_received_log_without_addresses_is_not_checked(self):
        self.received({"v": 1, "at": iso(self.now - 300), "source": "beat-tower", "transport": "http", "result": "ok"})
        self.assertEqual(self.checks()["loopback pushers"].verdict, doctor.SKIP)

    def test_read_only_and_overall(self):
        before = sorted(p.name for p in self.data.rglob("*"))
        checks = doctor.host_checks(self.now)
        self.assertEqual(sorted(p.name for p in self.data.rglob("*")), before)
        self.assertEqual(doctor.host_overall(checks)[1], 0)
        self.assertEqual(doctor.host_overall([doctor.skip("x", "why")])[1], 1)   # nothing checked is never a pass


if __name__ == "__main__":
    unittest.main()
