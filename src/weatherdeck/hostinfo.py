"""Which addresses to listen on, which profiles each serves, and a label for this host.

hosts.bind is a list of entries, each either "ADDRESS" (serves every profile) or
{"address": "ADDRESS", "profiles": ["public"]} (serves only those). ADDRESS is "localhost", a
literal IP address (a LAN or VPN address), or "auto:<cidr>" (every local interface address inside
that range, when present). 0.0.0.0 and :: are refused.
"""
import ipaddress
import re
import socket
from urllib.parse import urlsplit

from . import osx


class BindError(ValueError):
    pass


def local_addresses():
    """IPv4 addresses of this machine's interfaces, using only what the OS ships."""
    found = set()
    if osx.IS_WIN:
        out = osx.command_output(["ipconfig"])
        found.update(re.findall(r"IPv4[^\r\n:]*:\s*(\d+\.\d+\.\d+\.\d+)", out))
    else:
        for cmd in (["ip", "-o", "-4", "addr", "show"], ["ifconfig", "-a"]):
            out = osx.command_output(cmd)
            found.update(re.findall(r"\binet (?:addr:)?(\d+\.\d+\.\d+\.\d+)", out))
            if found:
                break
    try:
        found.update(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        pass
    try:  # the address the OS would use to leave the machine; a UDP connect sends nothing
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))
            found.add(s.getsockname()[0])
    except OSError:
        pass
    return sorted(found)


def normalize(entries, profile_names):
    out = []
    for e in entries:
        if isinstance(e, str):
            e = {"address": e}
        if not isinstance(e, dict) or not isinstance(e.get("address"), str):
            raise BindError(f"hosts.bind entries are an address or {{address, profiles}}, not {e!r}")
        profs = e.get("profiles")
        if profs is not None:
            if not isinstance(profs, list) or not profs or any(p not in profile_names for p in profs):
                raise BindError(f"hosts.bind {e['address']!r}: profiles must be a non-empty list of {sorted(profile_names)}")
        out.append({"address": e["address"], "profiles": list(profs) if profs else None})
    return out


def resolve(entries, profile_names):
    """-> ({address: profiles or None}, [auto entries still waiting for an address])."""
    addrs, waiting = {}, []

    def add(addr, profs):
        if addr in addrs:
            cur = addrs[addr]
            addrs[addr] = None if cur is None or profs is None else sorted(set(cur) | set(profs))
        else:
            addrs[addr] = profs

    for e in normalize(entries, profile_names):
        a, profs = e["address"], e["profiles"]
        if a == "localhost":
            add("127.0.0.1", profs)
        elif a.startswith("auto:"):
            try:
                net = ipaddress.ip_network(a[5:], strict=False)
            except ValueError:
                raise BindError(f"bad range in hosts.bind: {a!r}")
            hits = [x for x in local_addresses() if ipaddress.ip_address(x) in net]
            for x in hits:
                add(x, profs)
            if not hits:
                waiting.append(e)
        else:
            try:
                ip = ipaddress.ip_address(a)
            except ValueError:
                raise BindError(f"hosts.bind addresses are localhost, an IP address or auto:<cidr>, not {a!r}")
            if ip.is_unspecified:
                raise BindError("binding to every interface (0.0.0.0 or ::) is refused; list the addresses you want")
            add(str(ip), profs)
    return addrs, waiting


DEMO = False  # set by `--demo`: the demo must not put this machine's name on screen


def host_label(cfg):
    return cfg["hosts"].get("label") or ("demo host" if DEMO else socket.gethostname().split(".")[0])


# ---- which Host names this host answers to -------------------------------------------------------
DEFAULT_PORT = {"http": 80, "https": 443}


def canonical_name(name):
    name = name.strip().lower().rstrip(".")
    try:
        return ipaddress.ip_address(name).compressed
    except ValueError:
        return name


def parse_authority(value):
    """'Host: name:8787' or the authority of an Origin -> (lowercase name without brackets, port or None);
    None for anything that is not a plain host[:port]."""
    value = (value or "").strip()
    if not value or any(c in value for c in "@/\\?# \t"):
        return None
    try:
        parts = urlsplit("//" + value)
        name, port = parts.hostname, parts.port
    except ValueError:
        return None
    return (canonical_name(name), port) if name else None


def allowed_names(cfg, bound=None):
    """Names a request's Host header may carry: the loopback names, the address this listener is bound
    to, this machine's own hostname, and hosts.allowed_hosts. A DNS-rebinding page reaches the host under
    its own name, which is never in this set."""
    names = {"localhost", "127.0.0.1", "::1"}
    if bound:
        names.add(canonical_name(bound))
    try:
        full = socket.gethostname().lower()
        short = full.split(".")[0]
        names.update(n for n in (full, short, short + ".local") if n)
    except OSError:
        pass
    for extra in cfg["hosts"].get("allowed_hosts") or []:
        parsed = parse_authority(extra) if isinstance(extra, str) else None
        if parsed:
            names.add(parsed[0])
    return names


def host_refusal(headers, cfg, bound=None):
    """None when the Host header is acceptable, else a short reason. A request with no Host header at all
    cannot come from a browser, so it passes."""
    raw = headers.get("Host")
    if raw is None:
        return None
    parsed = parse_authority(raw)
    if parsed is None or parsed[0] not in allowed_names(cfg, bound):
        return f"Host {raw[:80]!r} is not one of this host's names; add its name to hosts.allowed_hosts in the config"
    return None


def origin_refusal(headers):
    """None when there is no Origin header or it is this host's own (same scheme, name and port as the
    Host header), else a short reason. 'null' (sandboxed pages, files) is never the host's own."""
    raw = headers.get("Origin")
    if raw is None:
        return None
    shown = f"Origin {raw[:80]!r} is not this host's own"
    try:
        o = urlsplit(raw)
        scheme, theirs = o.scheme.lower(), parse_authority(o.netloc)
    except ValueError:
        return shown
    ours = parse_authority(headers.get("Host"))
    if scheme not in DEFAULT_PORT or o.path not in ("", "/") or theirs is None or ours is None:
        return shown
    if theirs[0] != ours[0] or (theirs[1] or DEFAULT_PORT[scheme]) != (ours[1] or DEFAULT_PORT[scheme]):
        return shown
    return None
