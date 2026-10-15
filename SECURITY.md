# Security policy

## Reporting a vulnerability

Please report a suspected vulnerability privately, through GitHub's private vulnerability reporting: open this repository's **Security** tab, choose **Report a vulnerability**, and fill in the form. Do not open a public issue, pull request or discussion for it.

There is no e-mail address for reports; the report form is the one channel, and the conversation stays in it.

Include, as far as you can:

- what you found and what it lets someone do;
- the steps, command or request that shows it, and the output;
- your operating system, Python version and the version of this project;
- whether anything private (a token, a path, a host name) was exposed, without pasting the private value itself.

## What to expect

This project is run by one maintainer in spare time, so the promises are small and plain:

- No response time is guaranteed. A report is read when the maintainer can, on a best effort basis.
- A straight answer on whether it is a vulnerability, and if not, why not.
- A fix or a documented limit when it is real, and credit in the changelog if you want it.
- Please give time to fix it before you tell anyone else.

## Supported versions

Only the latest release is supported. Older releases, forks and patched copies get no fixes; update first and check that the problem is still there.

## In scope

- The host accepting a push it should have refused (no token, wrong token, wrong address) or showing a view it should have hidden (the tv and public views are meant to drop private fields).
- Anything that makes the tool write outside its own data directory, run a command the code does not name, or print a secret.
- A path-handling or parsing flaw reachable from a feed, a drop-directory card or a config file.

## Out of scope

- Findings that need an attacker who can already write the data directory, the config or the drop directory (they can already do everything the tool does).
- Denial of service by sending a very large feed to a host you exposed on purpose.
- The board being wrong or stale (that is a bug, not a vulnerability: see [SUPPORT.md](SUPPORT.md)).
- Adapters and tools written by others, and their own pushers.
