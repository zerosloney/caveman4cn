---
name: caveman-stats
description: >
  Show real token usage and estimated savings for the current session.
  Reads directly from the CodeBuddy session logs — no AI estimation.
  Triggers on /caveman-stats. Output is produced by the mode-tracker hook;
  the model itself does not compute the numbers.
---

> **Status:** Not yet wired up for CodeBuddy. The ZCode build ships a
> `UserPromptSubmit` mode-tracker hook (`hooks/caveman-mode-tracker.js` +
> `hooks/caveman-stats.js`) that reads `model_complete` usage records from the
> session transcript and prints formatted stats. That tracker has not been
> ported to the CodeBuddy hook contract yet. When invoked, reply:
> "Caveman stats not available in this build."

When implemented, the contract will be: the hook reads CodeBuddy session
transcripts, computes input/output/cache token usage plus an estimated
baseline (output × 2.86, the caveman compression factor), and returns the
formatted numbers via `continue: false` + `reason` so the host prints them and
the model never runs. Planned flags:
- `--lifetime` / `--all` — union every session, not just the newest.
- `--share` — one-line summary (`⛏ Session: N tokens saved (~X%) via caveman mode`).
