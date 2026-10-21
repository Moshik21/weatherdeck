# Cua fixtures

Hand-written, synthetic stand-ins for the output of the `cua` command, one folder per situation, read by `tests/test_cuapush.py`
through `cua_push.py --fixture`. **They were not recorded from a live cua**: it was not available when they were written, so every
command name, field name and status word here is the one Cua's published description gives, or an assumption, and none is checked.
Replace them with real recordings, and fix the pusher's assumptions, once a cua can be run. No real name, host or id is in them.

A file is named for its command: `spaces ls` is `spaces-ls.json`, `agent status run-9` is `agent-status-run-9.json`, `--version` is
`version.txt`. A recorded failure is a `.err` file (exit 1, that text on standard error). A command with no file is a verb that cua
does not have.

| Folder | Situation |
| --- | --- |
| `normal` | two hosts up; runs working, idle and ready for a message, idle and closed, and one with no status in the list; an access request, a turn end and an answered request; usage |
| `offline-host` | one host's Spaces are `offline` and `not sharing`, and one Space has a phase this pusher does not know (`paused`), with runs on them that Cua still lists |
| `crashed-run` | a crashed run, a failed run, and the failure notification for each |
| `schema-drift` | the experimental contract moved: other list shapes, a new run status, a new notification kind, a usage figure with no limit, no notifications verb |
| `signed-out` | every command refuses because nobody is signed in |

Missing CLI has no folder: the test asks for a command that does not exist.
