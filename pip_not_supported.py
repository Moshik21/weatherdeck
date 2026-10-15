"""A build backend that only refuses: Weatherdeck cannot be installed with pip yet.

The command, the page and the demo data are found next to the source tree, not inside an installed
package, so a wheel would install without error and then fail on first use. Refusing at build time
says so before that happens. Run it from a checkout or the release zip: `python3 bin/weatherdeck run --demo`.
"""

MESSAGE = (
    "Weatherdeck cannot be installed with pip yet: it runs from a source checkout or the release zip "
    "(python3 bin/weatherdeck run --demo, see README.md). Nothing was installed."
)


def _refuse(*_args, **_kwargs):
    raise RuntimeError(MESSAGE)


get_requires_for_build_wheel = get_requires_for_build_sdist = get_requires_for_build_editable = _refuse
prepare_metadata_for_build_wheel = prepare_metadata_for_build_editable = _refuse
build_wheel = build_sdist = build_editable = _refuse
