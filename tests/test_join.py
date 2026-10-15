"""Acceptance tests for adding a machine (unreleased, onboarding slice 5): `weatherdeck invite` and `weatherdeck join --dry-run`.

    python3 -m unittest discover -s tests

Added under the same deliberate, narrow exception as tests/test_contract.py (CONTRIBUTING.md, "Tests"), because the task
brief for this slice asked for them: each named failure of the join preflight reproduced against a scratch host (an
unreachable port, a silent port, a Host name the host refuses, a bad token through the 411/401 probe, an expired invite,
a source id already taken, an injected clock skew, a machine id that disagrees), the Windows Store-alias refusal and the
other machine checks with injected platform facts, the join string, and the invite registry and expiry the host enforces.
Synthetic data only, standard library only; the host binds a scratch port on 127.0.0.1 and writes only to a temporary
data directory, and the machine side reads only a temporary home.
"""
import argparse
import contextlib
import io
import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from weatherdeck import cli, config, ingest, join, server  # noqa: E402

TOKEN = "t0ken-" + "a" * 37


def feed(source, machine):
    return json.dumps({"schema": "lookout.feed", "schema_version": "1.0", "source": {"id": source, "machine": machine},
                       "items": [{"id": "x", "title": "Synthetic item", "state": "running"}]}).encode()


def quiet(fn, *args):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = fn(*args)
    return code, out.getvalue()


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Facts:
    """A healthy Linux machine with a temporary home; a test changes one fact to make one check fail."""

    @staticmethod
    def linux(home, **over):
        facts = {"os": "linux", "wsl": False, "hostname": "synthbox", "home": str(home), "env": {},
                 "python": {"path": "/usr/bin/python3", "base": None, "version": (3, 11, 2)}, "py_launcher": [],
                 "service": (True, "systemd user manager"), "installs": [], "scheduler": "systemd", "crontab": True,
                 "linger": {"user": "synth", "state": "yes", "why": "loginctl show-user"},
                 "dirs": join.join_dirs("linux", str(home), {}), "can_write": join.can_write}
        facts.update(over)
        return facts


def names(findings, level=None):
    return [f.name for f in findings if f.name and (level is None or f.level == level)]


class JoinString(unittest.TestCase):
    def test_round_trip(self):
        s = join.make_string("http://[fd7a:115c::5]:18000/", "beat-lab", "lab", 1_800_000_000, TOKEN)
        self.assertEqual(join.parse_string("  " + s + "\n"), join.Invite("http://[fd7a:115c::5]:18000", "beat-lab", "lab", 1_800_000_000, TOKEN))

    def test_a_damaged_paste_is_named_and_the_error_never_repeats_the_token(self):
        s = join.make_string("http://127.0.0.1:18000", "beat-lab", "lab", 1_800_000_000, TOKEN)
        for bad in (s[:-6], s.replace("beat-lab", "beat-lib"), "wdjoin2" + s[7:], ""):
            with self.assertRaises(join.JoinStringError) as cm:
                join.parse_string(bad)
            self.assertNotIn(TOKEN, str(cm.exception))

    def test_ttl(self):
        self.assertEqual(join.parse_ttl("15m"), 900)
        self.assertEqual(join.parse_ttl("2h"), 7200)
        for bad in ("10", "30s", "8d", "x"):
            with self.assertRaises(ValueError):
                join.parse_ttl(bad)


class MachineChecks(unittest.TestCase):
    """Platform facts injected; no host involved."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.home = Path(self._tmp.name)

    def test_store_alias_is_refused_with_the_real_interpreter_named(self):
        alias = r"D:\Profiles\synth\AppData\Local\Microsoft\WindowsApps\pythonw.exe"
        real = r"D:\Profiles\synth\AppData\Local\Programs\Python\Python312\python.exe"
        f = join.store_alias_check({"path": alias, "base": None}, [alias, real])
        self.assertEqual((f.level, f.name), ("FAIL", "STORE_ALIAS"))
        self.assertIn("WindowsApps", f.text)
        self.assertIn(r"Python312\pythonw.exe", f.next)
        pkg = r"C:\Program Files\WindowsApps\PythonSoftwareFoundation.Python.3.12_3.12.2032.0_x64__qbz5n2kfra8p0\python.exe"
        f = join.store_alias_check({"path": r"C:\venv\Scripts\python.exe", "base": pkg}, [])
        self.assertEqual(f.name, "STORE_ALIAS")
        self.assertIn("python.org", f.next)
        self.assertEqual(join.store_alias_check({"path": real, "base": real}, [real]).level, "ok")

    def test_windows_facts_run_the_alias_check(self):
        facts = Facts.linux(self.home, os="windows", python={"path": r"D:\Profiles\s\AppData\Local\Microsoft\WindowsApps\python.exe",
                                                             "base": None, "version": (3, 12, 4)})
        self.assertEqual(names(join._python_checks(facts), "FAIL"), ["STORE_ALIAS"])
        self.assertEqual(names(join._python_checks(Facts.linux(self.home)), "FAIL"), [])

    def test_python_older_than_39_is_refused(self):
        facts = Facts.linux(self.home, python={"path": "/usr/bin/python3.8", "base": None, "version": (3, 8, 10)})
        found = join._python_checks(facts)
        self.assertEqual(names(found, "FAIL"), ["PYTHON_TOO_OLD"])
        self.assertIn("3.8.10", found[0].text)

    def test_no_service_manager_and_cannot_write(self):
        facts = Facts.linux(self.home, service=(False, "systemd user manager"), wsl=True, can_write=lambda d: "cache" not in d)
        found = join._machine_checks(facts)
        self.assertEqual(names(found, "FAIL"), ["NO_SERVICE_MANAGER", "CANNOT_WRITE"])
        self.assertIn("wsl.conf", found[0].next)
        self.assertIn("weatherdeck-beat", next(f.text for f in found if f.name == "CANNOT_WRITE"))

    @unittest.skipIf(os.name == "nt" or (hasattr(os, "geteuid") and os.geteuid() == 0), "POSIX modes, not as root")
    def test_a_read_only_home_cannot_be_written(self):
        os.chmod(self.home, 0o500)
        self.addCleanup(os.chmod, self.home, 0o700)
        self.assertFalse(join.can_write(join.join_dirs("linux", str(self.home), {})["config"]))

    def test_earlier_installs_are_found(self):
        units = self.home / ".config" / "systemd" / "user"
        units.mkdir(parents=True)
        (units / "weatherdeck-beat.service").write_text("[Service]\n")
        (units / "weatherdeck-adapter-synth.timer").write_text("[Timer]\n")
        (units / "unrelated.service").write_text("[Service]\n")
        cron = "# m h dom mon dow command\n*/5 * * * * /opt/lookout-beat run\n"
        found = join.find_installs("linux", str(self.home), {}, crontab=cron)
        self.assertEqual(sorted(k for k, _, _ in found), ["beat", "beat", "pusher"])
        self.assertTrue(any("systemctl --user disable --now weatherdeck-beat.service" in r for _, _, r in found))
        tasks = '"\\weatherdeck-beat","N/A","Ready"\r\n"\\Weatherdeck host","N/A","Running"\r\n'
        found = join.find_installs("windows", "D:\\Profiles\\synth", {"USERPROFILE": "D:\\Profiles\\synth"}, tasks=tasks)
        self.assertEqual([(k, r) for k, _, r in found], [("beat", 'schtasks /delete /tn "weatherdeck-beat" /f')])
        found = join._machine_checks(Facts.linux(self.home, installs=join.find_installs("linux", str(self.home), {})))
        self.assertEqual(names(found, "FAIL"), ["ALREADY_JOINED"])

    def test_machine_ids_disagree_inside_wsl(self):
        self.assertEqual(join.machine_ids("Synth.lan", True), {"installer": "synth", "beat": "synth-wsl"})
        self.assertEqual(join.machine_ids("Synth.lan", False), {"installer": "synth", "beat": "synth"})


class Lingering(unittest.TestCase):
    """A systemd user unit dies with the last login session unless lingering is on (no host involved; shims, never the real loginctl)."""
    INV = join.Invite("http://192.0.2.10:8787", "beat-laptop", "laptop", 1_800_000_000, TOKEN)

    def facts(self, state, **over):
        return Facts.linux("/home/synth", linger={"user": "synth", "state": state, "why": "shim"}, **over)

    def test_lingering_off_is_a_named_failure_with_the_one_line_remedy_and_the_plan_is_not_ready(self):
        facts = self.facts("no")
        found = join.linger_checks(facts)
        self.assertEqual(names(found, "FAIL"), ["LINGER_OFF"])
        self.assertTrue(found[0].next.startswith("loginctl enable-linger synth"))
        self.assertIn("last login session", found[0].text)
        text = join.render(self.INV, found, facts)
        self.assertIn("1 named failure(s): LINGER_OFF", text)
        self.assertNotIn("ready to join", text)
        self.assertIn("linger found off for synth; changed by the join: no", text)
        self.assertIn("leaves linger exactly as found", text)

    def test_lingering_on_is_ok_and_unreadable_is_a_failure_not_a_pass(self):
        self.assertEqual(join.linger_checks(self.facts("yes"))[0].level, "ok")
        self.assertEqual(names(join.linger_checks(self.facts(None)), "FAIL"), ["LINGER_UNKNOWN"])

    def test_cron_or_a_system_unit_is_the_named_fallback_and_does_not_need_lingering(self):
        for how in ("cron", "system"):
            found = join.linger_checks(self.facts("no", scheduler=how))
            self.assertEqual(names(found, "FAIL"), [], how)
            self.assertIn("left as found", found[0].text)
        self.assertEqual(names(join.linger_checks(self.facts("no", scheduler="cron", crontab=False)), "FAIL"), ["NO_CRON"])
        self.assertIn("crontab line", "\n".join(join.plan_lines(self.INV, self.facts("no", scheduler="cron"))))

    def test_wsl_and_hosts_without_a_user_manager_keep_their_own_findings(self):
        self.assertEqual(join.linger_checks(self.facts("no", wsl=True)), [])
        self.assertEqual(join.linger_checks(self.facts("no", service=(False, "systemd user manager"))), [])
        self.assertEqual(join.linger_checks(self.facts("no", os="darwin")), [])

    def test_cron_or_system_on_a_host_without_a_user_manager_is_not_blocked_by_it(self):
        bare = dict(service=(False, "systemd user manager"))
        for how in ("cron", "system"):
            facts = self.facts(None, scheduler=how, **bare)
            self.assertNotIn("NO_SERVICE_MANAGER", names(join._machine_checks(facts), "FAIL"))
            found = join.linger_checks(facts)
            self.assertEqual(found[0].level, "ok")
            self.assertEqual(names(found, "FAIL"), [])
        self.assertEqual(names(join.linger_checks(self.facts(None, scheduler="cron", crontab=False, **bare)), "FAIL"), ["NO_CRON"])
        self.assertEqual(names(join.linger_checks(self.facts(None, scheduler="system", system_manager=False, **bare)), "FAIL"),
                         ["NO_SERVICE_MANAGER"])
        self.assertIn("NO_SERVICE_MANAGER", names(join._machine_checks(self.facts(None, **bare)), "FAIL"))

    def test_a_scheduler_that_does_not_apply_here_is_named_in_the_plan(self):
        plan = "\n".join(join.plan_lines(self.INV, self.facts("no", scheduler="cron", os="darwin")))
        self.assertIn("--scheduler cron applies to Linux outside WSL only", plan)
        self.assertNotIn("applies to Linux", "\n".join(join.plan_lines(self.INV, self.facts("no"))))

    def test_an_unreadable_user_name_never_prints_a_placeholder_user(self):
        linger = join.read_linger(lambda cmd: self.fail("no loginctl without a user"), None)
        found = join.linger_checks(Facts.linux("/home/synth", linger=linger))
        self.assertEqual(names(found, "FAIL"), ["LINGER_UNKNOWN"])
        text = " ".join(f.text + " " + f.next for f in found)
        self.assertNotIn("USER", text)
        self.assertNotIn("None", text)

    def test_an_adapter_pusher_that_is_a_user_unit_is_named_at_risk_and_the_beat_goes_in_beside_it(self):
        pusher = ("pusher", "/home/user/.config/systemd/user/weatherdeck-adapter-synth.timer", "x")
        found = join.linger_checks(self.facts("no", installs=[pusher]))
        self.assertEqual(names(found, "warn"), ["PUSHER_AT_RISK"])
        plan = "\n".join(join.plan_lines(self.INV, self.facts("yes", installs=[pusher])))
        self.assertIn("weatherdeck-beat-beat-laptop.service", plan)
        self.assertIn("source beat-laptop, machine laptop", plan)
        self.assertIn("added beside them", plan)
        self.assertEqual(join.linger_checks(self.facts("yes", installs=[pusher]))[0].level, "ok")

    def test_read_linger_reads_loginctl_and_says_when_it_cannot(self):
        ok = lambda cmd: (0, "Linger=no\n")
        self.assertEqual(join.read_linger(ok, "synth")["state"], "no")
        self.assertEqual(join.read_linger(lambda cmd: (0, "Linger=yes\n"), "synth")["state"], "yes")
        gone = join.read_linger(lambda cmd: (None, ""), "synth")
        self.assertEqual((gone["state"], gone["why"]), (None, "loginctl is not there"))
        self.assertIsNone(join.read_linger(lambda cmd: (1, "Failed to get user: not logged in\n"), "synth")["state"])


class ScratchHost(unittest.TestCase):
    """A host on a scratch loopback port with a temporary data directory, and a joining machine with a temporary home."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        saved = dict(config._state)
        self.addCleanup(config._state.update, saved)
        self.data = Path(self._tmp.name) / "host"
        self.home = Path(self._tmp.name) / "home"
        self.home.mkdir()
        config.init(data_dir=str(self.data), config_path=str(self.data / "config.json"))
        self.srv = server.Listener(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(self.srv.server_close)
        self.addCleanup(self.srv.shutdown)
        self.url = f"http://127.0.0.1:{self.srv.server_address[1]}"

    def invite(self, machine="laptop", **kw):
        args = argparse.Namespace(machine=machine, source=kw.get("source"), ttl=kw.get("ttl", "15m"), url=kw.get("url", self.url))
        code, out = quiet(join.cmd_invite, args)
        line = next((x for x in out.splitlines() if x.startswith(join.PREFIX)), None)
        return code, out, (join.parse_string(line) if line else None)

    def dry_run(self, inv, facts=None, now=time.time, **http):
        return join.preflight(inv, facts or Facts.linux(self.home), join.Http(inv.url, **dict({"timeout": 3}, **http)), now=now)

    def received_lines(self):
        try:
            return ingest.received_log_path().read_text().splitlines()
        except FileNotFoundError:
            return []

    def push(self, token, body):
        req = urllib.request.Request(self.url + "/api/ingest", data=body, method="POST",
                                     headers={"Content-Type": "application/json", "Authorization": "Bearer " + token})
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status, resp.read().decode()
        except urllib.error.HTTPError as exc:
            with exc:
                return exc.code, exc.read().decode()


class Invite(ScratchHost):
    def test_one_string_shown_once_and_a_minimal_registry(self):
        code, out, inv = self.invite()
        self.assertEqual(code, 0)
        self.assertEqual(out.count(inv.token), 1)
        self.assertEqual((inv.source, inv.machine, inv.url), ("beat-laptop", "laptop", self.url))
        self.assertAlmostEqual(inv.expires, time.time() + 900, delta=5)
        reg = json.loads((self.data / "invites.json").read_text())
        self.assertEqual(set(reg["invites"]["beat-laptop"]), {"machine", "url", "created_at", "expires_at", "joined_at"})
        self.assertNotIn(inv.token, (self.data / "invites.json").read_text())
        if os.name != "nt":
            self.assertEqual((self.data / "invites.json").stat().st_mode & 0o777, 0o600)

    def test_a_taken_id_is_refused_and_an_open_invite_is_replaced(self):
        _, _, first = self.invite()
        code, out, again = self.invite()
        self.assertEqual(code, 0)
        self.assertIn("replaces the open invite", out)
        self.assertEqual(self.push(first.token, feed("beat-laptop", "laptop"))[0], 401)
        self.assertEqual(self.push(again.token, feed("beat-laptop", "laptop"))[0], 200)
        code, out, none = self.invite()
        self.assertEqual((code, none), (1, None))
        self.assertIn("ID_TAKEN", out)

    def test_token_revoke_drops_the_invite(self):
        self.invite()
        quiet(cli.cmd_token, argparse.Namespace(action="revoke", name="beat-laptop", read=False))
        self.assertEqual(join.read_registry()["invites"], {})

    def test_token_new_drops_an_expired_invite(self):
        self.invite()
        reg = join.read_registry()
        reg["invites"]["beat-laptop"]["expires_at"] = "2020-01-01T00:00:00Z"
        (self.data / "invites.json").write_text(json.dumps(reg))
        _, out = quiet(cli.cmd_token, argparse.Namespace(action="new", name="beat-laptop", read=False))
        self.assertEqual(join.read_registry()["invites"], {})
        token = next(x for x in out.splitlines() if x and " " not in x)
        self.assertEqual(self.push(token, feed("beat-laptop", "laptop"))[0], 200)

    def test_the_host_enforces_the_expiry_until_a_first_push(self):
        _, _, inv = self.invite()
        self.assertEqual(self.push(inv.token, feed("beat-laptop", "laptop"))[0], 200)
        self.assertTrue(join.read_registry()["invites"]["beat-laptop"]["joined_at"])
        _, _, late = self.invite(machine="desk")
        reg = join.read_registry()
        reg["invites"]["beat-desk"]["expires_at"] = "2020-01-01T00:00:00Z"
        reg["invites"]["beat-laptop"]["expires_at"] = "2020-01-01T00:00:00Z"
        (self.data / "invites.json").write_text(json.dumps(reg))
        code, text = self.push(late.token, feed("beat-desk", "desk"))
        self.assertEqual(code, 401)
        self.assertIn("expired", text)
        self.assertEqual(self.push(inv.token, feed("beat-laptop", "laptop"))[0], 200)  # joined before: unaffected


class DryRun(ScratchHost):
    def test_a_good_invite_passes_and_the_probe_stores_nothing(self):
        _, _, inv = self.invite()
        before = self.received_lines()
        found = self.dry_run(inv)
        self.assertEqual(names(found, "FAIL"), [])
        self.assertTrue(any("accepts this token" in f.text for f in found))
        self.assertEqual(self.received_lines(), before)
        self.assertFalse((self.data / "sources" / "beat-laptop.json").exists())
        self.assertEqual(list(self.home.iterdir()), [])
        self.assertIn("ready to join", join.render(inv, found))
        self.assertNotIn(inv.token, join.render(inv, found))

    def test_bad_token_is_refused_by_the_401_probe_and_nothing_is_logged(self):
        self.invite()
        bad = join.Invite(self.url, "beat-laptop", "laptop", int(time.time()) + 600, TOKEN)
        found = self.dry_run(bad)
        self.assertEqual(names(found, "FAIL"), ["TOKEN_REFUSED (401)"])
        self.assertEqual(self.received_lines(), [])

    def test_expired_invite(self):
        _, _, inv = self.invite()
        reg = join.read_registry()
        reg["invites"]["beat-laptop"]["expires_at"] = "2020-01-01T00:00:00Z"
        (self.data / "invites.json").write_text(json.dumps(reg))
        self.assertEqual(names(self.dry_run(inv), "FAIL"), ["INVITE_EXPIRED"])

    def test_unreachable_port(self):
        _, _, inv = self.invite(url=f"http://127.0.0.1:{free_port()}")
        found = self.dry_run(inv, timeout=10)  # Windows retries a refused loopback connect for about 2 s
        self.assertEqual(names(found, "FAIL"), ["HOST_UNREACHABLE (refused)"])
        self.assertIn("weatherdeck status", found[-2].next)

    def test_firewall_style_timeout(self):
        silent = socket.socket()
        silent.bind(("127.0.0.1", 0))
        silent.listen(1)  # accepts connections (the kernel does) and never answers
        self.addCleanup(silent.close)
        _, _, inv = self.invite(url=f"http://127.0.0.1:{silent.getsockname()[1]}")
        found = self.dry_run(inv, timeout=0.5)
        self.assertEqual(names(found, "FAIL"), ["HOST_UNREACHABLE (timeout)"])
        self.assertIn("firewall", found[-2].next)

    def test_host_name_refused(self):
        _, out, inv = self.invite(url=f"http://board.invalid:{self.srv.server_address[1]}")
        self.assertIn("HOST_NAME_REFUSED", out)  # invite already warns
        with self.assertLogs("weatherdeck.server", "WARNING"):  # the host logs the refused name
            found = self.dry_run(inv, connect_to="127.0.0.1")  # reach the scratch host under a name it does not hold
        self.assertEqual(names(found, "FAIL"), ["HOST_NAME_REFUSED"])
        self.assertIn("allowed_hosts", found[-2].next)

    def test_id_taken(self):
        _, _, inv = self.invite()
        self.assertEqual(ingest.ingest(feed("beat-laptop", "other-box"), transport="stdin").code, ingest.OK)
        found = self.dry_run(inv)
        self.assertEqual(names(found, "FAIL"), ["ID_TAKEN"])
        self.assertIn("other-box", next(f.text for f in found if f.name == "ID_TAKEN"))

    def test_skew_injected_is_a_warning_not_a_stop(self):
        _, _, inv = self.invite()
        found = self.dry_run(inv, now=lambda: time.time() - 3 * 3600)
        self.assertEqual(names(found, "FAIL"), [])
        self.assertEqual(names(found, "warn"), ["CLOCK_SKEW"])
        self.assertIn("behind", next(f.text for f in found if f.name == "CLOCK_SKEW"))

    def test_wsl_machine_id_that_disagrees_with_the_existing_ship(self):
        self.assertEqual(ingest.ingest(feed("fm-synth", "synthbox"), transport="stdin").code, ingest.OK)
        _, _, inv = self.invite(machine="synthbox-wsl")
        found = self.dry_run(inv, Facts.linux(self.home, wsl=True))
        self.assertEqual(names(found, "warn"), ["MACHINE_ID_DIFFERS"])
        self.assertIn("--machine synthbox", next(f.next for f in found if f.name == "MACHINE_ID_DIFFERS"))
        _, _, other = self.invite(machine="synthbox", source="beat-elsewhere")
        found = self.dry_run(other, Facts.linux(self.home, hostname="elsewhere"))
        self.assertEqual(names(found, "warn"), ["MACHINE_ID_SHARED"])


if __name__ == "__main__":
    unittest.main()
