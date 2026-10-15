/* Generated from fixture.json so the page also opens from file://. Regenerate: see README.md. */
window.HH_FIXTURE = {
 "schema": "lookout.fixture",
 "fixture_version": "1.0",
 "title": "Synthetic fleet for phase-2 design concepts",
 "note": "Every name, title and number is invented. feeds[] are lookout.feed 1.0 documents (docs/feed-spec.md) that pass src/weatherdeck/schema.py validate() and can be pushed to a host with POST /api/ingest. Ages on screen are computed from 'now' below; a static mockup should use it as the clock. scenarios[] say how each required state differs from 'normal'.",
 "now": "2026-10-08T19:30:00Z",
 "display": {
  "tz": "UTC",
  "quiet_hours": {
   "start": "23:00",
   "end": "07:30"
  }
 },
 "machines_summary": {
  "kestrel": "main workstation, healthy, 9 lanes",
  "basalt": "always-on host, healthy, 6 lanes",
  "tern": "lab server, degraded (disk 11 GB, swap 64%, load 14/8), 3 lanes"
 },
 "projects": {
  "orrery": "a space-trading game (10 lanes)",
  "folio": "a long-form writing app (8 lanes)"
 },
 "coverage": {
  "viewer_call": "a-epub-call / k-epub-footnotes (waiting 2 h 11 min)",
  "merge_waiting": "a-spellcheck-merge / k-spellcheck-loader (100%, awaiting your merge 25 min)",
  "stuck_long_test": "k-save-migration (test 2 h 38 min vs typical 44 min, p90 70 min, quiet 23 min)",
  "degraded_machine": "tern (status warn) + a-tern-degraded",
  "scouts": "k-scout-sync (reported ~60%, no honest percent), b-scout-crashes (no percent)",
  "honest_ranges": "0-37 and 0-39 build, 31-38 stopped at review, 36-41 regressed to round 2 (default weights), 41-75 test, 60-62 publish, 74-76 document, 77-100 checks, 100 done, plus no percent for state-only, unknown, scouts; failed, blocked, waiting on supervisor",
  "self_landed": "b-shader-cache (merged itself 12 min ago)",
  "capacity": "a-weekly-allowance (Kestrel week 18%, empty Sat 10:00 before Sat 19:00 reset)",
  "info_only": "a-spare-signin (info severity: shown as an 'also' line, never counted)"
 },
 "feeds": [
  {
   "schema": "lookout.feed",
   "schema_version": "1.0",
   "source": {
    "id": "kestrel-main",
    "label": "Kestrel, main",
    "machine": "kestrel",
    "kind": "primary",
    "peers": [
     "basalt-mate",
     "tern-mate"
    ]
   },
   "producer": {
    "name": "synthetic-fixture",
    "version": "1.0",
    "boot_id": "fixture",
    "seq": 1,
    "mode": "sample"
   },
   "generated_at": "2026-10-08T19:29:52Z",
   "interval_s": 20,
   "collect_ms": 900,
   "collectors": [
    {
     "id": "items",
     "as_of": "2026-10-08T19:29:51Z",
     "status": "ok",
     "error": null,
     "warnings": 0
    },
    {
     "id": "machines",
     "as_of": "2026-10-08T19:29:50Z",
     "status": "ok",
     "error": null,
     "warnings": 0
    },
    {
     "id": "queue",
     "as_of": "2026-10-08T19:29:51Z",
     "status": "ok",
     "error": null,
     "warnings": 0
    },
    {
     "id": "attention",
     "as_of": "2026-10-08T19:29:51Z",
     "status": "ok",
     "error": null,
     "warnings": 0
    },
    {
     "id": "meters",
     "as_of": "2026-10-08T19:27:40Z",
     "status": "ok",
     "error": null,
     "warnings": 0
    }
   ],
   "machines": [
    {
     "id": "kestrel",
     "label": "Kestrel",
     "role": "main workstation",
     "status": "ok",
     "as_of": "2026-10-08T19:29:50Z",
     "reach": {
      "probe_ok": true,
      "rtt_ms": null,
      "last_ok_at": "2026-10-08T19:29:50Z",
      "error": null
     },
     "load": {
      "l1": 3.1,
      "l5": 2.7,
      "cores": 12
     },
     "mem": {
      "used_pct": 71,
      "swap_used_pct": 6
     },
     "disks": [
      {
       "label": "SSD",
       "free_gb": 312,
       "free_pct": 34,
       "warn_gb": 50,
       "crit_gb": 25
      }
     ],
     "uptime_s": 1209600,
     "on_battery": false,
     "extras": [
      {
       "label": "supervision",
       "value": "beat 8 s ago",
       "severity": null
      },
      {
       "label": "pipeline daemon",
       "value": "up",
       "severity": null
      },
      {
       "label": "wake queue",
       "value": "2",
       "severity": null
      },
      {
       "label": "lanes",
       "value": "9 of 10",
       "severity": null
      }
     ]
    },
    {
     "id": "basalt",
     "label": "Basalt",
     "role": null,
     "status": "unknown",
     "as_of": "2026-10-08T19:29:35Z",
     "reach": {
      "probe_ok": true,
      "rtt_ms": 11,
      "last_ok_at": "2026-10-08T19:29:35Z",
      "error": null
     },
     "load": null,
     "mem": null,
     "disks": [],
     "uptime_s": null,
     "on_battery": null,
     "extras": []
    },
    {
     "id": "tern",
     "label": "Tern",
     "role": null,
     "status": "unknown",
     "as_of": "2026-10-08T19:29:35Z",
     "reach": {
      "probe_ok": true,
      "rtt_ms": 38,
      "last_ok_at": "2026-10-08T19:29:35Z",
      "error": null
     },
     "load": null,
     "mem": null,
     "disks": [],
     "uptime_s": null,
     "on_battery": null,
     "extras": []
    }
   ],
   "items": [
    {
     "id": "k-orbital-planner",
     "owner": null,
     "relayed": false,
     "group": "orrery",
     "machine": "kestrel",
     "kind": "task",
     "title": "Orbital transfer planner",
     "doing": "Review clean after round 2; tests running",
     "state": "running",
     "state_detail": "validating (running)",
     "started_at": "2026-10-08T16:50:00Z",
     "last_event": {
      "state": "running",
      "text": "review round 2 clean",
      "at": "2026-10-08T18:52:00Z"
     },
     "progress": {
      "basis": "history",
      "history_n": 14,
      "percent_floor": 41,
      "percent_ceiling": 75,
      "regressed": false,
      "reason": null,
      "current": {
       "step": "test",
       "elapsed_s": 1860,
       "typical_s": 2640,
       "p90_s": 4224,
       "round": 2,
       "activity": "active",
       "last_activity_age_s": 30,
       "waiting_since": null
      },
      "steps": [
       {
        "id": "dispatched",
        "label": "Dispatched",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 0,
        "p90_s": 0,
        "round": null
       },
       {
        "id": "build",
        "label": "Build",
        "status": "done",
        "weight": 0.387,
        "elapsed_s": 3120,
        "typical_s": 3120,
        "p90_s": 4992,
        "round": null
       },
       {
        "id": "intent",
        "label": "Intent",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 1,
        "p90_s": 1,
        "round": null
       },
       {
        "id": "rebase",
        "label": "Rebase",
        "status": "done",
        "weight": 0.001,
        "elapsed_s": 7,
        "typical_s": 8,
        "p90_s": 12,
        "round": null
       },
       {
        "id": "review",
        "label": "Review",
        "status": "done",
        "weight": 0.03,
        "elapsed_s": 211,
        "typical_s": 240,
        "p90_s": 384,
        "round": null
       },
       {
        "id": "test",
        "label": "Test",
        "status": "current",
        "weight": 0.327,
        "elapsed_s": 1860,
        "typical_s": 2640,
        "p90_s": 4224,
        "round": 2
       },
       {
        "id": "document",
        "label": "Document",
        "status": "pending",
        "weight": 0.015,
        "elapsed_s": null,
        "typical_s": 120,
        "p90_s": 192,
        "round": null
       },
       {
        "id": "lint",
        "label": "Lint",
        "status": "pending",
        "weight": 0.002,
        "elapsed_s": null,
        "typical_s": 15,
        "p90_s": 24,
        "round": null
       },
       {
        "id": "push",
        "label": "Push",
        "status": "pending",
        "weight": 0.001,
        "elapsed_s": null,
        "typical_s": 6,
        "p90_s": 9,
        "round": null
       },
       {
        "id": "pr",
        "label": "Publish",
        "status": "pending",
        "weight": 0.007,
        "elapsed_s": null,
        "typical_s": 60,
        "p90_s": 96,
        "round": null
       },
       {
        "id": "ci",
        "label": "Checks",
        "status": "pending",
        "weight": 0.23,
        "elapsed_s": null,
        "typical_s": 1860,
        "p90_s": 2976,
        "round": null
       }
      ]
     },
     "handoff": {
      "state": "none",
      "since": null
     },
     "link": null,
     "flags": [
      "fix_round"
     ],
     "needs_you": false
    },
    {
     "id": "k-save-migration",
     "owner": null,
     "relayed": false,
     "group": "orrery",
     "machine": "kestrel",
     "kind": "task",
     "title": "Save-file migration v3",
     "doing": "Test step has run 2 h 38 min; no output for 23 min",
     "state": "running",
     "state_detail": "validating (running)",
     "started_at": "2026-10-08T15:10:00Z",
     "last_event": {
      "state": "running",
      "text": "test step started",
      "at": "2026-10-08T16:52:00Z"
     },
     "progress": {
      "basis": "history",
      "history_n": 14,
      "percent_floor": 41,
      "percent_ceiling": 75,
      "regressed": false,
      "reason": null,
      "current": {
       "step": "test",
       "elapsed_s": 9480,
       "typical_s": 2640,
       "p90_s": 4224,
       "round": null,
       "activity": "quiet",
       "last_activity_age_s": 1380,
       "waiting_since": null
      },
      "steps": [
       {
        "id": "dispatched",
        "label": "Dispatched",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 0,
        "p90_s": 0,
        "round": null
       },
       {
        "id": "build",
        "label": "Build",
        "status": "done",
        "weight": 0.387,
        "elapsed_s": 3120,
        "typical_s": 3120,
        "p90_s": 4992,
        "round": null
       },
       {
        "id": "intent",
        "label": "Intent",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 1,
        "p90_s": 1,
        "round": null
       },
       {
        "id": "rebase",
        "label": "Rebase",
        "status": "done",
        "weight": 0.001,
        "elapsed_s": 7,
        "typical_s": 8,
        "p90_s": 12,
        "round": null
       },
       {
        "id": "review",
        "label": "Review",
        "status": "done",
        "weight": 0.03,
        "elapsed_s": 211,
        "typical_s": 240,
        "p90_s": 384,
        "round": null
       },
       {
        "id": "test",
        "label": "Test",
        "status": "current",
        "weight": 0.327,
        "elapsed_s": 9480,
        "typical_s": 2640,
        "p90_s": 4224,
        "round": null
       },
       {
        "id": "document",
        "label": "Document",
        "status": "pending",
        "weight": 0.015,
        "elapsed_s": null,
        "typical_s": 120,
        "p90_s": 192,
        "round": null
       },
       {
        "id": "lint",
        "label": "Lint",
        "status": "pending",
        "weight": 0.002,
        "elapsed_s": null,
        "typical_s": 15,
        "p90_s": 24,
        "round": null
       },
       {
        "id": "push",
        "label": "Push",
        "status": "pending",
        "weight": 0.001,
        "elapsed_s": null,
        "typical_s": 6,
        "p90_s": 9,
        "round": null
       },
       {
        "id": "pr",
        "label": "Publish",
        "status": "pending",
        "weight": 0.007,
        "elapsed_s": null,
        "typical_s": 60,
        "p90_s": 96,
        "round": null
       },
       {
        "id": "ci",
        "label": "Checks",
        "status": "pending",
        "weight": 0.23,
        "elapsed_s": null,
        "typical_s": 1860,
        "p90_s": 2976,
        "round": null
       }
      ]
     },
     "handoff": {
      "state": "none",
      "since": null
     },
     "link": null,
     "flags": [
      "running_long",
      "quiet"
     ],
     "needs_you": false
    },
    {
     "id": "k-epub-footnotes",
     "owner": null,
     "relayed": false,
     "group": "folio",
     "machine": "kestrel",
     "kind": "task",
     "title": "Footnote export to EPUB",
     "doing": "Review stopped at a finding that needs your call",
     "state": "waiting",
     "state_detail": "parked at review",
     "started_at": "2026-10-08T16:25:00Z",
     "last_event": {
      "state": "waiting",
      "text": "asked: embed fonts or link them",
      "at": "2026-10-08T17:19:00Z"
     },
     "progress": {
      "basis": "history",
      "history_n": 9,
      "percent_floor": 31,
      "percent_ceiling": 38,
      "regressed": false,
      "reason": null,
      "current": {
       "step": "review",
       "elapsed_s": 540,
       "typical_s": 420,
       "p90_s": 672,
       "round": null,
       "activity": "waiting",
       "last_activity_age_s": 30,
       "waiting_since": "2026-10-08T17:19:00Z"
      },
      "steps": [
       {
        "id": "dispatched",
        "label": "Dispatched",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 0,
        "p90_s": 0,
        "round": null
       },
       {
        "id": "build",
        "label": "Build",
        "status": "done",
        "weight": 0.317,
        "elapsed_s": 2400,
        "typical_s": 2400,
        "p90_s": 3840,
        "round": null
       },
       {
        "id": "intent",
        "label": "Intent",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 1,
        "p90_s": 1,
        "round": null
       },
       {
        "id": "rebase",
        "label": "Rebase",
        "status": "done",
        "weight": 0.001,
        "elapsed_s": 8,
        "typical_s": 10,
        "p90_s": 16,
        "round": null
       },
       {
        "id": "review",
        "label": "Review",
        "status": "current",
        "weight": 0.055,
        "elapsed_s": 540,
        "typical_s": 420,
        "p90_s": 672,
        "round": null
       },
       {
        "id": "test",
        "label": "Test",
        "status": "pending",
        "weight": 0.198,
        "elapsed_s": null,
        "typical_s": 1500,
        "p90_s": 2400,
        "round": null
       },
       {
        "id": "document",
        "label": "Document",
        "status": "pending",
        "weight": 0.032,
        "elapsed_s": null,
        "typical_s": 240,
        "p90_s": 384,
        "round": null
       },
       {
        "id": "lint",
        "label": "Lint",
        "status": "pending",
        "weight": 0.005,
        "elapsed_s": null,
        "typical_s": 40,
        "p90_s": 64,
        "round": null
       },
       {
        "id": "push",
        "label": "Push",
        "status": "pending",
        "weight": 0.001,
        "elapsed_s": null,
        "typical_s": 6,
        "p90_s": 9,
        "round": null
       },
       {
        "id": "pr",
        "label": "Publish",
        "status": "pending",
        "weight": 0.008,
        "elapsed_s": null,
        "typical_s": 60,
        "p90_s": 96,
        "round": null
       },
       {
        "id": "ci",
        "label": "Checks",
        "status": "pending",
        "weight": 0.383,
        "elapsed_s": null,
        "typical_s": 2900,
        "p90_s": 4640,
        "round": null
       }
      ]
     },
     "handoff": {
      "state": "none",
      "since": null
     },
     "link": null,
     "flags": [],
     "needs_you": true
    },
    {
     "id": "k-spellcheck-loader",
     "owner": null,
     "relayed": false,
     "group": "folio",
     "machine": "kestrel",
     "kind": "task",
     "title": "Spellcheck dictionary loader",
     "doing": "Checks green; ready for your merge",
     "state": "done",
     "state_detail": "pr ready",
     "started_at": "2026-10-08T14:28:00Z",
     "last_event": {
      "state": "done",
      "text": "checks passed",
      "at": "2026-10-08T19:05:00Z"
     },
     "progress": {
      "basis": "history",
      "history_n": 9,
      "percent_floor": 100,
      "percent_ceiling": 100,
      "regressed": false,
      "reason": null,
      "current": null,
      "steps": [
       {
        "id": "dispatched",
        "label": "Dispatched",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 0,
        "p90_s": 0,
        "round": null
       },
       {
        "id": "build",
        "label": "Build",
        "status": "done",
        "weight": 0.317,
        "elapsed_s": 2400,
        "typical_s": 2400,
        "p90_s": 3840,
        "round": null
       },
       {
        "id": "intent",
        "label": "Intent",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 1,
        "p90_s": 1,
        "round": null
       },
       {
        "id": "rebase",
        "label": "Rebase",
        "status": "done",
        "weight": 0.001,
        "elapsed_s": 8,
        "typical_s": 10,
        "p90_s": 16,
        "round": null
       },
       {
        "id": "review",
        "label": "Review",
        "status": "done",
        "weight": 0.055,
        "elapsed_s": 369,
        "typical_s": 420,
        "p90_s": 672,
        "round": null
       },
       {
        "id": "test",
        "label": "Test",
        "status": "done",
        "weight": 0.198,
        "elapsed_s": 1680,
        "typical_s": 1500,
        "p90_s": 2400,
        "round": null
       },
       {
        "id": "document",
        "label": "Document",
        "status": "done",
        "weight": 0.032,
        "elapsed_s": 249,
        "typical_s": 240,
        "p90_s": 384,
        "round": null
       },
       {
        "id": "lint",
        "label": "Lint",
        "status": "done",
        "weight": 0.005,
        "elapsed_s": 44,
        "typical_s": 40,
        "p90_s": 64,
        "round": null
       },
       {
        "id": "push",
        "label": "Push",
        "status": "done",
        "weight": 0.001,
        "elapsed_s": 6,
        "typical_s": 6,
        "p90_s": 9,
        "round": null
       },
       {
        "id": "pr",
        "label": "Publish",
        "status": "done",
        "weight": 0.008,
        "elapsed_s": 57,
        "typical_s": 60,
        "p90_s": 96,
        "round": null
       },
       {
        "id": "ci",
        "label": "Checks",
        "status": "done",
        "weight": 0.383,
        "elapsed_s": 2784,
        "typical_s": 2900,
        "p90_s": 4640,
        "round": null
       }
      ]
     },
     "handoff": {
      "state": "awaiting_you",
      "since": "2026-10-08T19:05:00Z"
     },
     "link": {
      "url": "https://forge.example.invalid/folio/pull/212",
      "label": "change request 212"
     },
     "flags": [],
     "needs_you": true
    },
    {
     "id": "k-damage-model",
     "owner": null,
     "relayed": false,
     "group": "orrery",
     "machine": "kestrel",
     "kind": "task",
     "title": "Ship damage model",
     "doing": "Building: armour zones done, writing hit resolution",
     "state": "running",
     "state_detail": "working",
     "started_at": "2026-10-08T19:08:00Z",
     "last_event": null,
     "progress": {
      "basis": "history",
      "history_n": 14,
      "percent_floor": 0,
      "percent_ceiling": 39,
      "regressed": false,
      "reason": null,
      "current": {
       "step": "build",
       "elapsed_s": 1320,
       "typical_s": 3120,
       "p90_s": 4992,
       "round": null,
       "activity": "active",
       "last_activity_age_s": 30,
       "waiting_since": null
      },
      "steps": [
       {
        "id": "dispatched",
        "label": "Dispatched",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 0,
        "p90_s": 0,
        "round": null
       },
       {
        "id": "build",
        "label": "Build",
        "status": "current",
        "weight": 0.387,
        "elapsed_s": 1320,
        "typical_s": 3120,
        "p90_s": 4992,
        "round": null
       },
       {
        "id": "intent",
        "label": "Intent",
        "status": "pending",
        "weight": 0.0,
        "elapsed_s": null,
        "typical_s": 1,
        "p90_s": 1,
        "round": null
       },
       {
        "id": "rebase",
        "label": "Rebase",
        "status": "pending",
        "weight": 0.001,
        "elapsed_s": null,
        "typical_s": 8,
        "p90_s": 12,
        "round": null
       },
       {
        "id": "review",
        "label": "Review",
        "status": "pending",
        "weight": 0.03,
        "elapsed_s": null,
        "typical_s": 240,
        "p90_s": 384,
        "round": null
       },
       {
        "id": "test",
        "label": "Test",
        "status": "pending",
        "weight": 0.327,
        "elapsed_s": null,
        "typical_s": 2640,
        "p90_s": 4224,
        "round": null
       },
       {
        "id": "document",
        "label": "Document",
        "status": "pending",
        "weight": 0.015,
        "elapsed_s": null,
        "typical_s": 120,
        "p90_s": 192,
        "round": null
       },
       {
        "id": "lint",
        "label": "Lint",
        "status": "pending",
        "weight": 0.002,
        "elapsed_s": null,
        "typical_s": 15,
        "p90_s": 24,
        "round": null
       },
       {
        "id": "push",
        "label": "Push",
        "status": "pending",
        "weight": 0.001,
        "elapsed_s": null,
        "typical_s": 6,
        "p90_s": 9,
        "round": null
       },
       {
        "id": "pr",
        "label": "Publish",
        "status": "pending",
        "weight": 0.007,
        "elapsed_s": null,
        "typical_s": 60,
        "p90_s": 96,
        "round": null
       },
       {
        "id": "ci",
        "label": "Checks",
        "status": "pending",
        "weight": 0.23,
        "elapsed_s": null,
        "typical_s": 1860,
        "p90_s": 2976,
        "round": null
       }
      ]
     },
     "handoff": {
      "state": "none",
      "since": null
     },
     "link": null,
     "flags": [],
     "needs_you": false,
     "reported": {
      "label": "hit resolution next",
      "percent": 55,
      "basis": "reported",
      "at": "2026-10-08T19:24:00Z"
     }
    },
    {
     "id": "k-trade-heatmap",
     "owner": null,
     "relayed": false,
     "group": "orrery",
     "machine": "kestrel",
     "kind": "task",
     "title": "Trade route heatmap",
     "doing": "Change request open; checks running",
     "state": "running",
     "state_detail": "checks running",
     "started_at": "2026-10-08T16:00:00Z",
     "last_event": null,
     "progress": {
      "basis": "history",
      "history_n": 14,
      "percent_floor": 77,
      "percent_ceiling": 100,
      "regressed": false,
      "reason": null,
      "current": {
       "step": "ci",
       "elapsed_s": 780,
       "typical_s": 1860,
       "p90_s": 2976,
       "round": null,
       "activity": "active",
       "last_activity_age_s": 30,
       "waiting_since": null
      },
      "steps": [
       {
        "id": "dispatched",
        "label": "Dispatched",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 0,
        "p90_s": 0,
        "round": null
       },
       {
        "id": "build",
        "label": "Build",
        "status": "done",
        "weight": 0.387,
        "elapsed_s": 3120,
        "typical_s": 3120,
        "p90_s": 4992,
        "round": null
       },
       {
        "id": "intent",
        "label": "Intent",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 1,
        "p90_s": 1,
        "round": null
       },
       {
        "id": "rebase",
        "label": "Rebase",
        "status": "done",
        "weight": 0.001,
        "elapsed_s": 7,
        "typical_s": 8,
        "p90_s": 12,
        "round": null
       },
       {
        "id": "review",
        "label": "Review",
        "status": "done",
        "weight": 0.03,
        "elapsed_s": 211,
        "typical_s": 240,
        "p90_s": 384,
        "round": null
       },
       {
        "id": "test",
        "label": "Test",
        "status": "done",
        "weight": 0.327,
        "elapsed_s": 2956,
        "typical_s": 2640,
        "p90_s": 4224,
        "round": null
       },
       {
        "id": "document",
        "label": "Document",
        "status": "done",
        "weight": 0.015,
        "elapsed_s": 124,
        "typical_s": 120,
        "p90_s": 192,
        "round": null
       },
       {
        "id": "lint",
        "label": "Lint",
        "status": "done",
        "weight": 0.002,
        "elapsed_s": 16,
        "typical_s": 15,
        "p90_s": 24,
        "round": null
       },
       {
        "id": "push",
        "label": "Push",
        "status": "done",
        "weight": 0.001,
        "elapsed_s": 6,
        "typical_s": 6,
        "p90_s": 9,
        "round": null
       },
       {
        "id": "pr",
        "label": "Publish",
        "status": "done",
        "weight": 0.007,
        "elapsed_s": 57,
        "typical_s": 60,
        "p90_s": 96,
        "round": null
       },
       {
        "id": "ci",
        "label": "Checks",
        "status": "current",
        "weight": 0.23,
        "elapsed_s": 780,
        "typical_s": 1860,
        "p90_s": 2976,
        "round": null
       }
      ]
     },
     "handoff": {
      "state": "automatic",
      "since": null
     },
     "link": null,
     "flags": [],
     "needs_you": false
    },
    {
     "id": "k-scout-sync",
     "owner": null,
     "relayed": false,
     "group": "folio",
     "machine": "kestrel",
     "kind": "scout",
     "title": "Scout: offline sync options",
     "doing": "Comparing three sync libraries",
     "state": "running",
     "state_detail": null,
     "started_at": "2026-10-08T18:42:00Z",
     "last_event": null,
     "progress": {
      "basis": "none",
      "history_n": null,
      "percent_floor": null,
      "percent_ceiling": null,
      "regressed": false,
      "reason": "one long investigation; no honest midpoint",
      "current": null,
      "steps": [
       {
        "id": "dispatched",
        "label": "Dispatched",
        "status": "done",
        "weight": null,
        "elapsed_s": null,
        "typical_s": null,
        "p90_s": null,
        "round": null
       },
       {
        "id": "investigating",
        "label": "Investigating",
        "status": "current",
        "weight": null,
        "elapsed_s": null,
        "typical_s": null,
        "p90_s": null,
        "round": null
       },
       {
        "id": "report",
        "label": "Report",
        "status": "pending",
        "weight": null,
        "elapsed_s": null,
        "typical_s": null,
        "p90_s": null,
        "round": null
       }
      ]
     },
     "handoff": {
      "state": "none",
      "since": null
     },
     "link": null,
     "flags": [],
     "needs_you": false,
     "reported": {
      "label": "writing the comparison table",
      "percent": 60,
      "basis": "reported",
      "at": "2026-10-08T19:26:00Z"
     }
    },
    {
     "id": "k-paragraph-styles",
     "owner": null,
     "relayed": false,
     "group": "folio",
     "machine": "kestrel",
     "kind": "task",
     "title": "Paragraph styles panel",
     "doing": "Review found two issues; fixing them (round 2)",
     "state": "running",
     "state_detail": "validating (fixing)",
     "started_at": "2026-10-08T17:40:00Z",
     "last_event": null,
     "progress": {
      "basis": "default",
      "history_n": null,
      "percent_floor": 36,
      "percent_ceiling": 41,
      "regressed": true,
      "reason": null,
      "current": {
       "step": "review",
       "elapsed_s": 240,
       "typical_s": 300,
       "p90_s": 480,
       "round": 2,
       "activity": "active",
       "last_activity_age_s": 30,
       "waiting_since": null
      },
      "steps": [
       {
        "id": "dispatched",
        "label": "Dispatched",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 0,
        "p90_s": 0,
        "round": null
       },
       {
        "id": "build",
        "label": "Build",
        "status": "done",
        "weight": 0.362,
        "elapsed_s": 2700,
        "typical_s": 2700,
        "p90_s": 4320,
        "round": null
       },
       {
        "id": "intent",
        "label": "Intent",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 1,
        "p90_s": 1,
        "round": null
       },
       {
        "id": "rebase",
        "label": "Rebase",
        "status": "done",
        "weight": 0.001,
        "elapsed_s": 8,
        "typical_s": 10,
        "p90_s": 16,
        "round": null
       },
       {
        "id": "review",
        "label": "Review",
        "status": "current",
        "weight": 0.04,
        "elapsed_s": 240,
        "typical_s": 300,
        "p90_s": 480,
        "round": 2
       },
       {
        "id": "test",
        "label": "Test",
        "status": "pending",
        "weight": 0.241,
        "elapsed_s": null,
        "typical_s": 1800,
        "p90_s": 2880,
        "round": null
       },
       {
        "id": "document",
        "label": "Document",
        "status": "pending",
        "weight": 0.02,
        "elapsed_s": null,
        "typical_s": 150,
        "p90_s": 240,
        "round": null
       },
       {
        "id": "lint",
        "label": "Lint",
        "status": "pending",
        "weight": 0.004,
        "elapsed_s": null,
        "typical_s": 30,
        "p90_s": 48,
        "round": null
       },
       {
        "id": "push",
        "label": "Push",
        "status": "pending",
        "weight": 0.001,
        "elapsed_s": null,
        "typical_s": 6,
        "p90_s": 9,
        "round": null
       },
       {
        "id": "pr",
        "label": "Publish",
        "status": "pending",
        "weight": 0.008,
        "elapsed_s": null,
        "typical_s": 60,
        "p90_s": 96,
        "round": null
       },
       {
        "id": "ci",
        "label": "Checks",
        "status": "pending",
        "weight": 0.322,
        "elapsed_s": null,
        "typical_s": 2400,
        "p90_s": 3840,
        "round": null
       }
      ]
     },
     "handoff": {
      "state": "none",
      "since": null
     },
     "link": null,
     "flags": [
      "fix_round"
     ],
     "needs_you": false
    },
    {
     "id": "k-audio-occlusion",
     "owner": null,
     "relayed": false,
     "group": "orrery",
     "machine": "kestrel",
     "kind": "task",
     "title": "Audio occlusion pass",
     "doing": "Blocked until the asset bake on Tern finishes",
     "state": "blocked",
     "state_detail": "blocked on t-asset-bake",
     "started_at": "2026-10-08T17:44:00Z",
     "last_event": null,
     "progress": {
      "basis": "history",
      "history_n": 14,
      "percent_floor": 0,
      "percent_ceiling": 39,
      "regressed": false,
      "reason": null,
      "current": {
       "step": "build",
       "elapsed_s": 2460,
       "typical_s": 3120,
       "p90_s": 4992,
       "round": null,
       "activity": "waiting",
       "last_activity_age_s": 30,
       "waiting_since": "2026-10-08T18:25:00Z"
      },
      "steps": [
       {
        "id": "dispatched",
        "label": "Dispatched",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 0,
        "p90_s": 0,
        "round": null
       },
       {
        "id": "build",
        "label": "Build",
        "status": "current",
        "weight": 0.387,
        "elapsed_s": 2460,
        "typical_s": 3120,
        "p90_s": 4992,
        "round": null
       },
       {
        "id": "intent",
        "label": "Intent",
        "status": "pending",
        "weight": 0.0,
        "elapsed_s": null,
        "typical_s": 1,
        "p90_s": 1,
        "round": null
       },
       {
        "id": "rebase",
        "label": "Rebase",
        "status": "pending",
        "weight": 0.001,
        "elapsed_s": null,
        "typical_s": 8,
        "p90_s": 12,
        "round": null
       },
       {
        "id": "review",
        "label": "Review",
        "status": "pending",
        "weight": 0.03,
        "elapsed_s": null,
        "typical_s": 240,
        "p90_s": 384,
        "round": null
       },
       {
        "id": "test",
        "label": "Test",
        "status": "pending",
        "weight": 0.327,
        "elapsed_s": null,
        "typical_s": 2640,
        "p90_s": 4224,
        "round": null
       },
       {
        "id": "document",
        "label": "Document",
        "status": "pending",
        "weight": 0.015,
        "elapsed_s": null,
        "typical_s": 120,
        "p90_s": 192,
        "round": null
       },
       {
        "id": "lint",
        "label": "Lint",
        "status": "pending",
        "weight": 0.002,
        "elapsed_s": null,
        "typical_s": 15,
        "p90_s": 24,
        "round": null
       },
       {
        "id": "push",
        "label": "Push",
        "status": "pending",
        "weight": 0.001,
        "elapsed_s": null,
        "typical_s": 6,
        "p90_s": 9,
        "round": null
       },
       {
        "id": "pr",
        "label": "Publish",
        "status": "pending",
        "weight": 0.007,
        "elapsed_s": null,
        "typical_s": 60,
        "p90_s": 96,
        "round": null
       },
       {
        "id": "ci",
        "label": "Checks",
        "status": "pending",
        "weight": 0.23,
        "elapsed_s": null,
        "typical_s": 1860,
        "p90_s": 2976,
        "round": null
       }
      ]
     },
     "handoff": {
      "state": "none",
      "since": null
     },
     "link": null,
     "flags": [],
     "needs_you": false
    }
   ],
   "attention": [
    {
     "id": "a-epub-call",
     "kind": "decision",
     "severity": "action",
     "title": "Folio: embed fonts in EPUB exports, or link them?",
     "detail": "Embedding adds about 2 MB per book; linking breaks on some readers. The footnote export is stopped until you choose.",
     "since": "2026-10-08T17:19:00Z",
     "machine": "kestrel",
     "item": "k-epub-footnotes",
     "group": "folio",
     "link": null,
     "how": "Answer in the team chat"
    },
    {
     "id": "a-spellcheck-merge",
     "kind": "approval",
     "severity": "action",
     "title": "Merge ready: spellcheck dictionary loader",
     "detail": "Checks green for 25 min; review found nothing left to fix.",
     "since": "2026-10-08T19:05:00Z",
     "machine": "kestrel",
     "item": "k-spellcheck-loader",
     "group": "folio",
     "link": {
      "url": "https://forge.example.invalid/folio/pull/212",
      "label": "change request 212"
     },
     "how": "Say merge in the team chat"
    },
    {
     "id": "a-weekly-allowance",
     "kind": "capacity",
     "severity": "action",
     "title": "Kestrel's weekly allowance runs out before it resets",
     "detail": "18% left. At this pace it is empty Sat 10:00, 9 h before the Sat 19:00 reset.",
     "since": "2026-10-08T17:04:00Z",
     "machine": "kestrel",
     "item": null,
     "group": null,
     "link": null,
     "how": "Move heavy lanes to Basalt, or slow new dispatches"
    },
    {
     "id": "a-spare-signin",
     "kind": "credential",
     "severity": "info",
     "title": "Sign-in expired for a spare provider no lane uses",
     "detail": null,
     "since": "2026-10-08T10:30:00Z",
     "machine": "kestrel",
     "item": null,
     "group": null,
     "link": null,
     "how": "Sign in again when convenient"
    }
   ],
   "next": [
    {
     "id": "n-tech-tree",
     "group": "orrery",
     "title": "Tech tree: tier 3 unlock screen",
     "kind": "queued",
     "blocked_by": [
      "k-trade-heatmap"
     ],
     "reason": "starts after the trade route heatmap lands",
     "until": null,
     "filed": "2026-10-06"
    },
    {
     "id": "n-dictionary-import",
     "group": "folio",
     "title": "Custom dictionary import",
     "kind": "queued",
     "blocked_by": [],
     "reason": "waits for a free lane",
     "until": null,
     "filed": "2026-10-07"
    },
    {
     "id": "n-cut-015",
     "group": "orrery",
     "title": "Cut Orrery 0.15",
     "kind": "gate",
     "blocked_by": [
      "k-save-migration"
     ],
     "reason": "release waits on the save-file migration",
     "until": null,
     "filed": "2026-10-05"
    },
    {
     "id": "n-release-notes",
     "group": "folio",
     "title": "Folio 1.9 release notes",
     "kind": "held",
     "blocked_by": [],
     "reason": "you deferred it to Monday",
     "until": "2026-10-12",
     "filed": "2026-10-03"
    },
    {
     "id": "n-sim-tick",
     "group": "orrery",
     "title": "Profile the simulation tick on Basalt",
     "kind": "queued",
     "blocked_by": [],
     "reason": "next free Basalt lane",
     "until": null,
     "filed": "2026-10-08"
    }
   ],
   "done": [
    {
     "id": "d-minimap-pings",
     "owner": null,
     "group": "orrery",
     "title": "Minimap pings fade after 4 s",
     "via": "change request",
     "link": null,
     "at": "2026-10-08T17:43:00Z"
    },
    {
     "id": "d-autosave",
     "owner": null,
     "group": "folio",
     "title": "Autosave no longer crashes on long chapters",
     "via": "change request",
     "link": null,
     "at": "2026-10-08T16:05:00Z"
    },
    {
     "id": "d-fuzz-harness",
     "owner": null,
     "group": "orrery",
     "title": "Netcode fuzz harness runs on Tern",
     "via": "change request",
     "link": null,
     "at": "2026-10-08T15:29:00Z"
    },
    {
     "id": "d-quota-routing",
     "owner": null,
     "group": "orrery",
     "title": "Heavy lanes route by allowance runway",
     "via": "local merge",
     "link": null,
     "at": "2026-10-08T14:19:00Z"
    },
    {
     "id": "d-scout-epub",
     "owner": null,
     "group": "folio",
     "title": "Scout report: EPUB export options",
     "via": "report",
     "link": null,
     "at": "2026-10-08T12:50:00Z"
    },
    {
     "id": "d-word-count",
     "owner": null,
     "group": "folio",
     "title": "Live word count in the status bar",
     "via": "change request",
     "link": null,
     "at": "2026-10-08T12:28:00Z"
    }
   ],
   "events": [
    {
     "at": 1791486300,
     "item": "k-spellcheck-loader",
     "kind": "approval",
     "text": "Spellcheck dictionary loader"
    },
    {
     "at": 1791485520,
     "item": "k-orbital-planner",
     "kind": "update",
     "text": "Orbital transfer planner: review round 2 clean"
    },
    {
     "at": 1791484920,
     "item": "k-scout-sync",
     "kind": "started",
     "text": "Scout: offline sync options"
    },
    {
     "at": 1791481380,
     "item": "d-minimap-pings",
     "kind": "finished",
     "text": "Minimap pings fade after 4 s"
    },
    {
     "at": 1791479940,
     "item": "k-epub-footnotes",
     "kind": "waiting",
     "text": "Footnote export to EPUB"
    },
    {
     "at": 1791478320,
     "item": "k-save-migration",
     "kind": "update",
     "text": "Save-file migration v3: test step started"
    },
    {
     "at": 1791475500,
     "item": "d-autosave",
     "kind": "finished",
     "text": "Autosave no longer crashes on long chapters"
    }
   ],
   "groups": [
    {
     "id": "orrery",
     "label": "Orrery",
     "color": null,
     "checkpoint": {
      "as_of": "2026-10-08T18:50:00Z",
      "live": {
       "version": "0.14.2",
       "since": "2026-10-01"
      },
      "next": {
       "version": "0.15",
       "waiting_on": [
        "k-save-migration"
       ],
       "items_ready": 3
      },
      "gate": {
       "value": "pass",
       "as_of": "2026-10-08T16:30:00Z",
       "note": "floor check passed on 0.15 candidate"
      }
     }
    },
    {
     "id": "folio",
     "label": "Folio",
     "color": null,
     "checkpoint": {
      "as_of": "2026-10-08T18:50:00Z",
      "live": {
       "version": "1.8.3",
       "since": "2026-09-24"
      },
      "next": {
       "version": "1.9",
       "waiting_on": [
        "k-epub-footnotes"
       ],
       "items_ready": 2
      },
      "gate": {
       "value": "unknown",
       "as_of": null,
       "note": "not run for 1.9 yet"
      }
     }
    }
   ],
   "meters": {
    "as_of": "2026-10-08T19:27:40Z",
    "accounts": [
     {
      "id": "plan-kestrel",
      "label": "Primary plan, Kestrel",
      "machine": "kestrel",
      "windows": [
       {
        "id": "five_hour",
        "label": "5-hour",
        "percent_remaining": 62,
        "resets_at": "2026-10-08T21:40:00Z",
        "pace": "on_pace"
       },
       {
        "id": "week",
        "label": "Week",
        "percent_remaining": 18,
        "resets_at": "2026-10-10T19:00:00Z",
        "pace": "ahead"
       }
      ],
      "runway": {
       "status": "exhausts_before_reset",
       "confidence": "medium",
       "projected_empty_at": "2026-10-10T10:00:00Z",
       "source": "computed"
      }
     }
    ]
   },
   "counts": null,
   "omitted": []
  },
  {
   "schema": "lookout.feed",
   "schema_version": "1.0",
   "source": {
    "id": "basalt-mate",
    "label": "Basalt, second",
    "machine": "basalt",
    "kind": "secondary",
    "peers": [
     "kestrel-main"
    ]
   },
   "producer": {
    "name": "synthetic-fixture",
    "version": "1.0",
    "boot_id": "fixture",
    "seq": 1,
    "mode": "sample"
   },
   "generated_at": "2026-10-08T19:29:48Z",
   "interval_s": 20,
   "collect_ms": 640,
   "collectors": [
    {
     "id": "items",
     "as_of": "2026-10-08T19:29:48Z",
     "status": "ok",
     "error": null,
     "warnings": 0
    },
    {
     "id": "machines",
     "as_of": "2026-10-08T19:29:48Z",
     "status": "ok",
     "error": null,
     "warnings": 0
    },
    {
     "id": "queue",
     "as_of": "2026-10-08T19:29:48Z",
     "status": "ok",
     "error": null,
     "warnings": 0
    },
    {
     "id": "attention",
     "as_of": "2026-10-08T19:29:48Z",
     "status": "ok",
     "error": null,
     "warnings": 0
    },
    {
     "id": "meters",
     "as_of": "2026-10-08T19:27:10Z",
     "status": "ok",
     "error": null,
     "warnings": 0
    }
   ],
   "machines": [
    {
     "id": "basalt",
     "label": "Basalt",
     "role": "always-on host",
     "status": "ok",
     "as_of": "2026-10-08T19:29:48Z",
     "reach": {
      "probe_ok": true,
      "rtt_ms": null,
      "last_ok_at": "2026-10-08T19:29:48Z",
      "error": null
     },
     "load": {
      "l1": 5.8,
      "l5": 6.1,
      "cores": 24
     },
     "mem": {
      "used_pct": 48,
      "swap_used_pct": 0
     },
     "disks": [
      {
       "label": "System",
       "free_gb": 336,
       "free_pct": 35,
       "warn_gb": 80,
       "crit_gb": 60
      },
      {
       "label": "Data",
       "free_gb": 743,
       "free_pct": 81,
       "warn_gb": 50,
       "crit_gb": 25
      }
     ],
     "uptime_s": 518400,
     "on_battery": false,
     "extras": [
      {
       "label": "supervision",
       "value": "beat 11 s ago",
       "severity": null
      },
      {
       "label": "pipeline daemon",
       "value": "up",
       "severity": null
      },
      {
       "label": "lanes",
       "value": "6 of 8",
       "severity": null
      }
     ]
    }
   ],
   "items": [
    {
     "id": "b-pathfinding-bench",
     "owner": null,
     "relayed": false,
     "group": "orrery",
     "machine": "basalt",
     "kind": "task",
     "title": "Pathfinding benchmark on large maps",
     "doing": "Running the 4096-tile suite, 6 of 9 maps done",
     "state": "running",
     "state_detail": null,
     "started_at": "2026-10-08T18:18:00Z",
     "last_event": null,
     "progress": {
      "basis": "coarse",
      "history_n": null,
      "percent_floor": null,
      "percent_ceiling": null,
      "regressed": false,
      "reason": "this home reports state only",
      "current": null,
      "steps": [
       {
        "id": "dispatched",
        "label": "Dispatched",
        "status": "done",
        "weight": null,
        "elapsed_s": null,
        "typical_s": null,
        "p90_s": null,
        "round": null
       },
       {
        "id": "working",
        "label": "Working",
        "status": "current",
        "weight": null,
        "elapsed_s": null,
        "typical_s": null,
        "p90_s": null,
        "round": null
       },
       {
        "id": "ready",
        "label": "Ready",
        "status": "pending",
        "weight": null,
        "elapsed_s": null,
        "typical_s": null,
        "p90_s": null,
        "round": null
       },
       {
        "id": "landed",
        "label": "Landed",
        "status": "pending",
        "weight": null,
        "elapsed_s": null,
        "typical_s": null,
        "p90_s": null,
        "round": null
       }
      ]
     },
     "handoff": {
      "state": "none",
      "since": null
     },
     "link": null,
     "flags": [],
     "needs_you": false
    },
    {
     "id": "b-installer-signing",
     "owner": null,
     "relayed": false,
     "group": "folio",
     "machine": "basalt",
     "kind": "task",
     "title": "Windows installer signing",
     "doing": "Publishing the signed build",
     "state": "running",
     "state_detail": "publishing",
     "started_at": "2026-10-08T17:28:00Z",
     "last_event": null,
     "progress": {
      "basis": "history",
      "history_n": 7,
      "percent_floor": 60,
      "percent_ceiling": 62,
      "regressed": false,
      "reason": null,
      "current": {
       "step": "pr",
       "elapsed_s": 40,
       "typical_s": 60,
       "p90_s": 96,
       "round": null,
       "activity": "active",
       "last_activity_age_s": 30,
       "waiting_since": null
      },
      "steps": [
       {
        "id": "dispatched",
        "label": "Dispatched",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 0,
        "p90_s": 0,
        "round": null
       },
       {
        "id": "build",
        "label": "Build",
        "status": "done",
        "weight": 0.317,
        "elapsed_s": 2400,
        "typical_s": 2400,
        "p90_s": 3840,
        "round": null
       },
       {
        "id": "intent",
        "label": "Intent",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 1,
        "p90_s": 1,
        "round": null
       },
       {
        "id": "rebase",
        "label": "Rebase",
        "status": "done",
        "weight": 0.001,
        "elapsed_s": 8,
        "typical_s": 10,
        "p90_s": 16,
        "round": null
       },
       {
        "id": "review",
        "label": "Review",
        "status": "done",
        "weight": 0.055,
        "elapsed_s": 369,
        "typical_s": 420,
        "p90_s": 672,
        "round": null
       },
       {
        "id": "test",
        "label": "Test",
        "status": "done",
        "weight": 0.198,
        "elapsed_s": 1680,
        "typical_s": 1500,
        "p90_s": 2400,
        "round": null
       },
       {
        "id": "document",
        "label": "Document",
        "status": "done",
        "weight": 0.032,
        "elapsed_s": 249,
        "typical_s": 240,
        "p90_s": 384,
        "round": null
       },
       {
        "id": "lint",
        "label": "Lint",
        "status": "done",
        "weight": 0.005,
        "elapsed_s": 44,
        "typical_s": 40,
        "p90_s": 64,
        "round": null
       },
       {
        "id": "push",
        "label": "Push",
        "status": "done",
        "weight": 0.001,
        "elapsed_s": 6,
        "typical_s": 6,
        "p90_s": 9,
        "round": null
       },
       {
        "id": "pr",
        "label": "Publish",
        "status": "current",
        "weight": 0.008,
        "elapsed_s": 40,
        "typical_s": 60,
        "p90_s": 96,
        "round": null
       },
       {
        "id": "ci",
        "label": "Checks",
        "status": "pending",
        "weight": 0.383,
        "elapsed_s": null,
        "typical_s": 2900,
        "p90_s": 4640,
        "round": null
       }
      ]
     },
     "handoff": {
      "state": "none",
      "since": null
     },
     "link": null,
     "flags": [],
     "needs_you": false
    },
    {
     "id": "b-shader-cache",
     "owner": null,
     "relayed": false,
     "group": "orrery",
     "machine": "basalt",
     "kind": "task",
     "title": "Shader cache warmup",
     "doing": "Landed by itself when checks went green",
     "state": "done",
     "state_detail": "landed",
     "started_at": "2026-10-08T16:26:00Z",
     "last_event": null,
     "progress": {
      "basis": "history",
      "history_n": 14,
      "percent_floor": 100,
      "percent_ceiling": 100,
      "regressed": false,
      "reason": null,
      "current": null,
      "steps": [
       {
        "id": "dispatched",
        "label": "Dispatched",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 0,
        "p90_s": 0,
        "round": null
       },
       {
        "id": "build",
        "label": "Build",
        "status": "done",
        "weight": 0.387,
        "elapsed_s": 3120,
        "typical_s": 3120,
        "p90_s": 4992,
        "round": null
       },
       {
        "id": "intent",
        "label": "Intent",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 1,
        "p90_s": 1,
        "round": null
       },
       {
        "id": "rebase",
        "label": "Rebase",
        "status": "done",
        "weight": 0.001,
        "elapsed_s": 7,
        "typical_s": 8,
        "p90_s": 12,
        "round": null
       },
       {
        "id": "review",
        "label": "Review",
        "status": "done",
        "weight": 0.03,
        "elapsed_s": 211,
        "typical_s": 240,
        "p90_s": 384,
        "round": null
       },
       {
        "id": "test",
        "label": "Test",
        "status": "done",
        "weight": 0.327,
        "elapsed_s": 2956,
        "typical_s": 2640,
        "p90_s": 4224,
        "round": null
       },
       {
        "id": "document",
        "label": "Document",
        "status": "done",
        "weight": 0.015,
        "elapsed_s": 124,
        "typical_s": 120,
        "p90_s": 192,
        "round": null
       },
       {
        "id": "lint",
        "label": "Lint",
        "status": "done",
        "weight": 0.002,
        "elapsed_s": 16,
        "typical_s": 15,
        "p90_s": 24,
        "round": null
       },
       {
        "id": "push",
        "label": "Push",
        "status": "done",
        "weight": 0.001,
        "elapsed_s": 6,
        "typical_s": 6,
        "p90_s": 9,
        "round": null
       },
       {
        "id": "pr",
        "label": "Publish",
        "status": "done",
        "weight": 0.007,
        "elapsed_s": 57,
        "typical_s": 60,
        "p90_s": 96,
        "round": null
       },
       {
        "id": "ci",
        "label": "Checks",
        "status": "done",
        "weight": 0.23,
        "elapsed_s": 1785,
        "typical_s": 1860,
        "p90_s": 2976,
        "round": null
       }
      ]
     },
     "handoff": {
      "state": "complete",
      "since": "2026-10-08T19:18:00Z"
     },
     "link": null,
     "flags": [],
     "needs_you": false
    },
    {
     "id": "b-scout-crashes",
     "owner": null,
     "relayed": false,
     "group": "folio",
     "machine": "basalt",
     "kind": "scout",
     "title": "Scout: crash report triage",
     "doing": "Grouping 214 crash reports by stack",
     "state": "running",
     "state_detail": null,
     "started_at": "2026-10-08T17:59:00Z",
     "last_event": null,
     "progress": {
      "basis": "none",
      "history_n": null,
      "percent_floor": null,
      "percent_ceiling": null,
      "regressed": false,
      "reason": "one long investigation; no honest midpoint",
      "current": null,
      "steps": [
       {
        "id": "dispatched",
        "label": "Dispatched",
        "status": "done",
        "weight": null,
        "elapsed_s": null,
        "typical_s": null,
        "p90_s": null,
        "round": null
       },
       {
        "id": "investigating",
        "label": "Investigating",
        "status": "current",
        "weight": null,
        "elapsed_s": null,
        "typical_s": null,
        "p90_s": null,
        "round": null
       },
       {
        "id": "report",
        "label": "Report",
        "status": "pending",
        "weight": null,
        "elapsed_s": null,
        "typical_s": null,
        "p90_s": null,
        "round": null
       }
      ]
     },
     "handoff": {
      "state": "none",
      "since": null
     },
     "link": null,
     "flags": [],
     "needs_you": false
    },
    {
     "id": "b-replay-compression",
     "owner": null,
     "relayed": false,
     "group": "orrery",
     "machine": "basalt",
     "kind": "task",
     "title": "Replay compression",
     "doing": "Writing the docs for the new replay format",
     "state": "running",
     "state_detail": "validating (running)",
     "started_at": "2026-10-08T15:39:00Z",
     "last_event": null,
     "progress": {
      "basis": "history",
      "history_n": 14,
      "percent_floor": 74,
      "percent_ceiling": 76,
      "regressed": false,
      "reason": null,
      "current": {
       "step": "document",
       "elapsed_s": 70,
       "typical_s": 120,
       "p90_s": 192,
       "round": null,
       "activity": "active",
       "last_activity_age_s": 30,
       "waiting_since": null
      },
      "steps": [
       {
        "id": "dispatched",
        "label": "Dispatched",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 0,
        "p90_s": 0,
        "round": null
       },
       {
        "id": "build",
        "label": "Build",
        "status": "done",
        "weight": 0.387,
        "elapsed_s": 3120,
        "typical_s": 3120,
        "p90_s": 4992,
        "round": null
       },
       {
        "id": "intent",
        "label": "Intent",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 1,
        "p90_s": 1,
        "round": null
       },
       {
        "id": "rebase",
        "label": "Rebase",
        "status": "done",
        "weight": 0.001,
        "elapsed_s": 7,
        "typical_s": 8,
        "p90_s": 12,
        "round": null
       },
       {
        "id": "review",
        "label": "Review",
        "status": "done",
        "weight": 0.03,
        "elapsed_s": 211,
        "typical_s": 240,
        "p90_s": 384,
        "round": null
       },
       {
        "id": "test",
        "label": "Test",
        "status": "done",
        "weight": 0.327,
        "elapsed_s": 2956,
        "typical_s": 2640,
        "p90_s": 4224,
        "round": null
       },
       {
        "id": "document",
        "label": "Document",
        "status": "current",
        "weight": 0.015,
        "elapsed_s": 70,
        "typical_s": 120,
        "p90_s": 192,
        "round": null
       },
       {
        "id": "lint",
        "label": "Lint",
        "status": "pending",
        "weight": 0.002,
        "elapsed_s": null,
        "typical_s": 15,
        "p90_s": 24,
        "round": null
       },
       {
        "id": "push",
        "label": "Push",
        "status": "pending",
        "weight": 0.001,
        "elapsed_s": null,
        "typical_s": 6,
        "p90_s": 9,
        "round": null
       },
       {
        "id": "pr",
        "label": "Publish",
        "status": "pending",
        "weight": 0.007,
        "elapsed_s": null,
        "typical_s": 60,
        "p90_s": 96,
        "round": null
       },
       {
        "id": "ci",
        "label": "Checks",
        "status": "pending",
        "weight": 0.23,
        "elapsed_s": null,
        "typical_s": 1860,
        "p90_s": 2976,
        "round": null
       }
      ]
     },
     "handoff": {
      "state": "none",
      "since": null
     },
     "link": null,
     "flags": [],
     "needs_you": false
    },
    {
     "id": "b-toc-generator",
     "owner": null,
     "relayed": false,
     "group": "folio",
     "machine": "basalt",
     "kind": "task",
     "title": "Table of contents generator",
     "doing": "Asked its supervisor which heading levels count; being answered",
     "state": "waiting",
     "state_detail": "waiting on supervisor",
     "started_at": "2026-10-08T18:32:00Z",
     "last_event": null,
     "progress": {
      "basis": "default",
      "history_n": null,
      "percent_floor": 0,
      "percent_ceiling": 37,
      "regressed": false,
      "reason": null,
      "current": {
       "step": "build",
       "elapsed_s": 1980,
       "typical_s": 2700,
       "p90_s": 4320,
       "round": null,
       "activity": "waiting",
       "last_activity_age_s": 30,
       "waiting_since": "2026-10-08T19:27:00Z"
      },
      "steps": [
       {
        "id": "dispatched",
        "label": "Dispatched",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 0,
        "p90_s": 0,
        "round": null
       },
       {
        "id": "build",
        "label": "Build",
        "status": "current",
        "weight": 0.362,
        "elapsed_s": 1980,
        "typical_s": 2700,
        "p90_s": 4320,
        "round": null
       },
       {
        "id": "intent",
        "label": "Intent",
        "status": "pending",
        "weight": 0.0,
        "elapsed_s": null,
        "typical_s": 1,
        "p90_s": 1,
        "round": null
       },
       {
        "id": "rebase",
        "label": "Rebase",
        "status": "pending",
        "weight": 0.001,
        "elapsed_s": null,
        "typical_s": 10,
        "p90_s": 16,
        "round": null
       },
       {
        "id": "review",
        "label": "Review",
        "status": "pending",
        "weight": 0.04,
        "elapsed_s": null,
        "typical_s": 300,
        "p90_s": 480,
        "round": null
       },
       {
        "id": "test",
        "label": "Test",
        "status": "pending",
        "weight": 0.241,
        "elapsed_s": null,
        "typical_s": 1800,
        "p90_s": 2880,
        "round": null
       },
       {
        "id": "document",
        "label": "Document",
        "status": "pending",
        "weight": 0.02,
        "elapsed_s": null,
        "typical_s": 150,
        "p90_s": 240,
        "round": null
       },
       {
        "id": "lint",
        "label": "Lint",
        "status": "pending",
        "weight": 0.004,
        "elapsed_s": null,
        "typical_s": 30,
        "p90_s": 48,
        "round": null
       },
       {
        "id": "push",
        "label": "Push",
        "status": "pending",
        "weight": 0.001,
        "elapsed_s": null,
        "typical_s": 6,
        "p90_s": 9,
        "round": null
       },
       {
        "id": "pr",
        "label": "Publish",
        "status": "pending",
        "weight": 0.008,
        "elapsed_s": null,
        "typical_s": 60,
        "p90_s": 96,
        "round": null
       },
       {
        "id": "ci",
        "label": "Checks",
        "status": "pending",
        "weight": 0.322,
        "elapsed_s": null,
        "typical_s": 2400,
        "p90_s": 3840,
        "round": null
       }
      ]
     },
     "handoff": {
      "state": "none",
      "since": null
     },
     "link": null,
     "flags": [],
     "needs_you": false
    }
   ],
   "attention": [],
   "next": [],
   "done": [
    {
     "id": "d-shader-cache",
     "owner": null,
     "group": "orrery",
     "title": "Shader cache warmup",
     "via": "merged itself",
     "link": null,
     "at": "2026-10-08T19:18:00Z"
    }
   ],
   "events": [
    {
     "at": 1791487080,
     "item": "b-shader-cache",
     "kind": "finished",
     "text": "Shader cache warmup"
    }
   ],
   "groups": [],
   "meters": {
    "as_of": "2026-10-08T19:27:10Z",
    "accounts": [
     {
      "id": "plan-basalt",
      "label": "Primary plan, Basalt",
      "machine": "basalt",
      "windows": [
       {
        "id": "five_hour",
        "label": "5-hour",
        "percent_remaining": 88,
        "resets_at": "2026-10-08T22:30:00Z",
        "pace": "behind"
       },
       {
        "id": "week",
        "label": "Week",
        "percent_remaining": 71,
        "resets_at": "2026-10-11T07:00:00Z",
        "pace": "behind"
       }
      ],
      "runway": {
       "status": "through_reset",
       "confidence": "high",
       "projected_empty_at": null,
       "source": "computed"
      }
     }
    ]
   },
   "counts": null,
   "omitted": []
  },
  {
   "schema": "lookout.feed",
   "schema_version": "1.0",
   "source": {
    "id": "tern-mate",
    "label": "Tern, lab",
    "machine": "tern",
    "kind": "secondary",
    "peers": [
     "kestrel-main"
    ]
   },
   "producer": {
    "name": "synthetic-fixture",
    "version": "1.0",
    "boot_id": "fixture",
    "seq": 1,
    "mode": "sample"
   },
   "generated_at": "2026-10-08T19:29:45Z",
   "interval_s": 30,
   "collect_ms": 4100,
   "collectors": [
    {
     "id": "items",
     "as_of": "2026-10-08T19:29:45Z",
     "status": "ok",
     "error": null,
     "warnings": 1
    },
    {
     "id": "machines",
     "as_of": "2026-10-08T19:29:45Z",
     "status": "ok",
     "error": null,
     "warnings": 0
    },
    {
     "id": "queue",
     "as_of": "2026-10-08T19:29:45Z",
     "status": "ok",
     "error": null,
     "warnings": 0
    },
    {
     "id": "attention",
     "as_of": "2026-10-08T19:29:45Z",
     "status": "ok",
     "error": null,
     "warnings": 0
    }
   ],
   "machines": [
    {
     "id": "tern",
     "label": "Tern",
     "role": "lab server",
     "status": "warn",
     "as_of": "2026-10-08T19:29:45Z",
     "reach": {
      "probe_ok": true,
      "rtt_ms": null,
      "last_ok_at": "2026-10-08T19:29:45Z",
      "error": null
     },
     "load": {
      "l1": 14.2,
      "l5": 12.9,
      "cores": 8
     },
     "mem": {
      "used_pct": 93,
      "swap_used_pct": 64
     },
     "disks": [
      {
       "label": "Disk",
       "free_gb": 11,
       "free_pct": 4,
       "warn_gb": 20,
       "crit_gb": 8
      }
     ],
     "uptime_s": 3542400,
     "on_battery": false,
     "extras": [
      {
       "label": "supervision",
       "value": "beat 19 s ago",
       "severity": null
      },
      {
       "label": "pipeline daemon",
       "value": "up",
       "severity": null
      },
      {
       "label": "lanes",
       "value": "3 of 4",
       "severity": null
      }
     ]
    }
   ],
   "items": [
    {
     "id": "t-asset-bake",
     "owner": null,
     "relayed": false,
     "group": "orrery",
     "machine": "tern",
     "kind": "task",
     "title": "Nightly asset bake",
     "doing": "Baking texture atlases; the machine is swapping",
     "state": "running",
     "state_detail": "working",
     "started_at": "2026-10-08T17:38:00Z",
     "last_event": null,
     "progress": {
      "basis": "history",
      "history_n": 14,
      "percent_floor": 0,
      "percent_ceiling": 39,
      "regressed": false,
      "reason": null,
      "current": {
       "step": "build",
       "elapsed_s": 6720,
       "typical_s": 3120,
       "p90_s": 4992,
       "round": null,
       "activity": "active",
       "last_activity_age_s": 90,
       "waiting_since": null
      },
      "steps": [
       {
        "id": "dispatched",
        "label": "Dispatched",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 0,
        "p90_s": 0,
        "round": null
       },
       {
        "id": "build",
        "label": "Build",
        "status": "current",
        "weight": 0.387,
        "elapsed_s": 6720,
        "typical_s": 3120,
        "p90_s": 4992,
        "round": null
       },
       {
        "id": "intent",
        "label": "Intent",
        "status": "pending",
        "weight": 0.0,
        "elapsed_s": null,
        "typical_s": 1,
        "p90_s": 1,
        "round": null
       },
       {
        "id": "rebase",
        "label": "Rebase",
        "status": "pending",
        "weight": 0.001,
        "elapsed_s": null,
        "typical_s": 8,
        "p90_s": 12,
        "round": null
       },
       {
        "id": "review",
        "label": "Review",
        "status": "pending",
        "weight": 0.03,
        "elapsed_s": null,
        "typical_s": 240,
        "p90_s": 384,
        "round": null
       },
       {
        "id": "test",
        "label": "Test",
        "status": "pending",
        "weight": 0.327,
        "elapsed_s": null,
        "typical_s": 2640,
        "p90_s": 4224,
        "round": null
       },
       {
        "id": "document",
        "label": "Document",
        "status": "pending",
        "weight": 0.015,
        "elapsed_s": null,
        "typical_s": 120,
        "p90_s": 192,
        "round": null
       },
       {
        "id": "lint",
        "label": "Lint",
        "status": "pending",
        "weight": 0.002,
        "elapsed_s": null,
        "typical_s": 15,
        "p90_s": 24,
        "round": null
       },
       {
        "id": "push",
        "label": "Push",
        "status": "pending",
        "weight": 0.001,
        "elapsed_s": null,
        "typical_s": 6,
        "p90_s": 9,
        "round": null
       },
       {
        "id": "pr",
        "label": "Publish",
        "status": "pending",
        "weight": 0.007,
        "elapsed_s": null,
        "typical_s": 60,
        "p90_s": 96,
        "round": null
       },
       {
        "id": "ci",
        "label": "Checks",
        "status": "pending",
        "weight": 0.23,
        "elapsed_s": null,
        "typical_s": 1860,
        "p90_s": 2976,
        "round": null
       }
      ]
     },
     "handoff": {
      "state": "none",
      "since": null
     },
     "link": null,
     "flags": [
      "machine_degraded"
     ],
     "needs_you": false
    },
    {
     "id": "t-rtf-fuzz",
     "owner": null,
     "relayed": false,
     "group": "folio",
     "machine": "tern",
     "kind": "task",
     "title": "Fuzz the RTF importer",
     "doing": "Last known: fuzzing round 4",
     "state": "unknown",
     "state_detail": "unknown",
     "started_at": "2026-10-08T17:15:00Z",
     "last_event": null,
     "progress": {
      "basis": "none",
      "history_n": null,
      "percent_floor": null,
      "percent_ceiling": null,
      "regressed": false,
      "reason": "state unreadable: its worker has not answered for 6 min",
      "current": null,
      "steps": [
       {
        "id": "dispatched",
        "label": "Dispatched",
        "status": "done",
        "weight": null,
        "elapsed_s": null,
        "typical_s": null,
        "p90_s": null,
        "round": null
       },
       {
        "id": "fuzzing",
        "label": "Fuzzing",
        "status": "current",
        "weight": null,
        "elapsed_s": null,
        "typical_s": null,
        "p90_s": null,
        "round": null
       },
       {
        "id": "report",
        "label": "Report",
        "status": "pending",
        "weight": null,
        "elapsed_s": null,
        "typical_s": null,
        "p90_s": null,
        "round": null
       }
      ]
     },
     "handoff": {
      "state": "none",
      "since": null
     },
     "link": null,
     "flags": [],
     "needs_you": false
    },
    {
     "id": "t-physics-soak",
     "owner": null,
     "relayed": false,
     "group": "orrery",
     "machine": "tern",
     "kind": "task",
     "title": "Physics determinism soak",
     "doing": "Test failed in round 3 (desync at tick 48 211); retrying from rebase",
     "state": "failed",
     "state_detail": "validating (failed)",
     "started_at": "2026-10-08T14:00:00Z",
     "last_event": null,
     "progress": {
      "basis": "history",
      "history_n": 14,
      "percent_floor": 41,
      "percent_ceiling": 75,
      "regressed": false,
      "reason": null,
      "current": {
       "step": "test",
       "elapsed_s": 3060,
       "typical_s": 2640,
       "p90_s": 4224,
       "round": 3,
       "activity": "quiet",
       "last_activity_age_s": 30,
       "waiting_since": null
      },
      "steps": [
       {
        "id": "dispatched",
        "label": "Dispatched",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 0,
        "p90_s": 0,
        "round": null
       },
       {
        "id": "build",
        "label": "Build",
        "status": "done",
        "weight": 0.387,
        "elapsed_s": 3120,
        "typical_s": 3120,
        "p90_s": 4992,
        "round": null
       },
       {
        "id": "intent",
        "label": "Intent",
        "status": "done",
        "weight": 0.0,
        "elapsed_s": 0,
        "typical_s": 1,
        "p90_s": 1,
        "round": null
       },
       {
        "id": "rebase",
        "label": "Rebase",
        "status": "done",
        "weight": 0.001,
        "elapsed_s": 7,
        "typical_s": 8,
        "p90_s": 12,
        "round": null
       },
       {
        "id": "review",
        "label": "Review",
        "status": "done",
        "weight": 0.03,
        "elapsed_s": 211,
        "typical_s": 240,
        "p90_s": 384,
        "round": null
       },
       {
        "id": "test",
        "label": "Test",
        "status": "failed",
        "weight": 0.327,
        "elapsed_s": 3060,
        "typical_s": 2640,
        "p90_s": 4224,
        "round": 3
       },
       {
        "id": "document",
        "label": "Document",
        "status": "pending",
        "weight": 0.015,
        "elapsed_s": null,
        "typical_s": 120,
        "p90_s": 192,
        "round": null
       },
       {
        "id": "lint",
        "label": "Lint",
        "status": "pending",
        "weight": 0.002,
        "elapsed_s": null,
        "typical_s": 15,
        "p90_s": 24,
        "round": null
       },
       {
        "id": "push",
        "label": "Push",
        "status": "pending",
        "weight": 0.001,
        "elapsed_s": null,
        "typical_s": 6,
        "p90_s": 9,
        "round": null
       },
       {
        "id": "pr",
        "label": "Publish",
        "status": "pending",
        "weight": 0.007,
        "elapsed_s": null,
        "typical_s": 60,
        "p90_s": 96,
        "round": null
       },
       {
        "id": "ci",
        "label": "Checks",
        "status": "pending",
        "weight": 0.23,
        "elapsed_s": null,
        "typical_s": 1860,
        "p90_s": 2976,
        "round": null
       }
      ]
     },
     "handoff": {
      "state": "none",
      "since": null
     },
     "link": null,
     "flags": [
      "retrying"
     ],
     "needs_you": false
    }
   ],
   "attention": [
    {
     "id": "a-tern-degraded",
     "kind": "machine",
     "severity": "action",
     "title": "Tern is struggling: 11 GB disk left, swap 64%",
     "detail": "Load 14 on 8 cores. The asset bake is slow and a soak test failed; both may be the machine, not the code.",
     "since": "2026-10-08T18:56:00Z",
     "machine": "tern",
     "item": null,
     "group": null,
     "link": null,
     "how": "Free disk on Tern, or move its lanes to Basalt"
    }
   ],
   "next": [],
   "done": [],
   "events": [
    {
     "at": 1791484740,
     "item": "t-physics-soak",
     "kind": "failed",
     "text": "Physics determinism soak: round 3 failed"
    }
   ],
   "groups": [],
   "meters": null,
   "counts": null,
   "omitted": []
  }
 ],
 "scenarios": [
  {
   "id": "normal",
   "what": "Day, everything reporting; 4 things wait on the viewer (3 action + 1 machine), 1 info.",
   "now": "2026-10-08T19:30:00Z",
   "theme": "day",
   "sources": {
    "kestrel-main": {
     "received_age_s": 6
    },
    "basalt-mate": {
     "received_age_s": 9
    },
    "tern-mate": {
     "received_age_s": 14
    }
   }
  },
  {
   "id": "all-clear",
   "what": "Nothing waits on the viewer: drop every attention item, set needs_you false, and set k-spellcheck-loader handoff to complete. The calm state must still read as a statement, not an empty panel.",
   "patch": {
    "attention": "remove all",
    "items.k-epub-footnotes.state": "running",
    "items.k-spellcheck-loader.handoff.state": "complete"
   },
   "sources": {
    "kestrel-main": {
     "received_age_s": 6
    },
    "basalt-mate": {
     "received_age_s": 9
    },
    "tern-mate": {
     "received_age_s": 14
    }
   }
  },
  {
   "id": "trouble",
   "what": "Adds a critical: supervision down on Kestrel. Critical outranks every action item.",
   "patch": {
    "kestrel-main.attention": "append supervision_down"
   },
   "supervision_down": {
    "id": "a-supervision-down",
    "kind": "service",
    "severity": "critical",
    "title": "Supervision is not beating on Kestrel",
    "detail": "Heartbeat 4 min old. Lanes keep running but nothing answers their questions.",
    "since": "2026-10-08T19:26:00Z",
    "machine": "kestrel",
    "item": null,
    "group": null,
    "link": null,
    "how": "Restart supervision on Kestrel"
   },
   "sources": {
    "kestrel-main": {
     "received_age_s": 6
    },
    "basalt-mate": {
     "received_age_s": 9
    },
    "tern-mate": {
     "received_age_s": 14
    }
   }
  },
  {
   "id": "night",
   "what": "23:40 local, quiet hours. Same data as normal. Night palette, no sound; the waiting count and any trouble stay the brightest marks.",
   "now": "2026-10-08T23:40:00Z",
   "theme": "night",
   "sources": {
    "kestrel-main": {
     "received_age_s": 6
    },
    "basalt-mate": {
     "received_age_s": 9
    },
    "tern-mate": {
     "received_age_s": 14
    }
   }
  },
  {
   "id": "one-source-silent",
   "what": "Tern has not reported for 16 min (lost after 15). Its machine row, 3 items and attention item stay on screen, fogged, hatched, timers frozen, labelled last known.",
   "sources": {
    "kestrel-main": {
     "received_age_s": 6
    },
    "basalt-mate": {
     "received_age_s": 9
    },
    "tern-mate": {
     "received_age_s": 960
    }
   }
  },
  {
   "id": "lost",
   "what": "No source has reported for 21 min. Full takeover: the board is last known, not current.",
   "sources": {
    "kestrel-main": {
     "received_age_s": 1260
    },
    "basalt-mate": {
     "received_age_s": 1290
    },
    "tern-mate": {
     "received_age_s": 1330
    }
   }
  },
  {
   "id": "host-down",
   "what": "The page cannot reach its host for 45 s. Show the age of the newest data and the next retry.",
   "host_unreachable_s": 45,
   "sources": {
    "kestrel-main": {
     "received_age_s": 51
    },
    "basalt-mate": {
     "received_age_s": 54
    },
    "tern-mate": {
     "received_age_s": 59
    }
   }
  },
  {
   "id": "empty",
   "what": "Waiting for the first source: no feed has ever arrived (feeds = []).",
   "feeds": []
  },
  {
   "id": "loading",
   "what": "Page opened; first /api/view response not back yet (0-2 s). Show the frame, never a spinner wall or fake zeros."
  }
 ],
 "viewports": [
  {
   "id": "tv-4k",
   "css": [
    1920,
    1080
   ],
   "dpr": 2,
   "physical": [
    3840,
    2160
   ],
   "distance_m": 3.0,
   "assumed_diagonal_in": 65
  },
  {
   "id": "tv-4k-dpr1",
   "css": [
    3840,
    2160
   ],
   "dpr": 1,
   "physical": [
    3840,
    2160
   ],
   "distance_m": 3.0,
   "assumed_diagonal_in": 65
  },
  {
   "id": "tv-1080",
   "css": [
    1920,
    1080
   ],
   "dpr": 1,
   "physical": [
    1920,
    1080
   ],
   "distance_m": 3.0,
   "assumed_diagonal_in": 55
  },
  {
   "id": "phone",
   "css": [
    390,
    844
   ],
   "dpr": 3,
   "physical": [
    1170,
    2532
   ],
   "distance_m": 0.35
  }
 ]
};
