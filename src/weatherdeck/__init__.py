"""Weatherdeck: a read-only, at-a-glance status board for work reported by many sources.

Standard library only.
"""
import sys

MIN_PYTHON = (3, 9)


def require_python(version_info=None):
    """Stop at startup with one plain sentence on an older Python, before a later module fails in some other way."""
    version_info = version_info or sys.version_info
    if tuple(version_info[:2]) < MIN_PYTHON:
        found = ".".join(str(n) for n in version_info[:3])
        sys.stderr.write("weatherdeck: needs Python %d.%d or newer, and this is Python %s.\n" % (MIN_PYTHON + (found,)))
        raise SystemExit(2)


require_python()

VERSION = "0.9.0"
NAME = "Weatherdeck"
