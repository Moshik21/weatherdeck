# Support

Weatherdeck is pre-1.0 hobby tooling that its author open-sourced for problems they had. Support is best effort, through GitHub issues, with no promise of a reply by any date.

## Where to ask

- **A question or how-to:** open an issue and say what you tried and what you expected.
- **A bug:** use the bug report template. If the board showed something that was not true, use "the board showed something wrong".
- **An idea:** use the feature request template. For anything large, say what problem it solves before proposing a design.
- **A security problem:** do not use issues; see [SECURITY.md](SECURITY.md).
- **A conduct problem:** do not use issues; see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## What to include

- The version (the first line of `weatherdeck status`; for a source checkout, also the commit).
- Your operating system and its version, and your Python version (`python3 --version`).
- The exact command you ran, or the exact feed or card you sent.
- The plain output, copied as text rather than described or shown as a picture: the error, or what the board showed against what you expected.
- No secrets: leave out tokens, host names, addresses, home paths and the names of people or accounts, or replace them with made-up ones. If a log contains any, edit them out before you paste it.

## What is supported

- The latest release, on Windows, macOS and Linux with Python 3.9 to 3.14 (3.8 is not supported).
- The documented feed format, the page, the config and the commands in the README and `docs/`.
- The bundled example adapter, as an example.

## What is not

- Old releases, and forks or patched copies.
- Adapters and tools written by others (a card or feed they send is read as it is; what they claim is theirs).
- Custom deployments, networks and devices beyond what the docs describe.
- Anything promising an answer by a date.

## The honesty promise

When this project cannot say something it says that, and a report that the board showed something it should not have is treated as a bug.

See also [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/honesty.md](docs/honesty.md).
