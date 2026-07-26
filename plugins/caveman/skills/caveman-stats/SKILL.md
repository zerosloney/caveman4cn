---
name: caveman-stats
description: >
  Show real token usage and estimated savings for the current session.
  Reads directly from the ZCode session logs — no AI estimation.
  Triggers on /caveman-stats. Output is produced by the mode-tracker hook;
  the model itself does not compute the numbers.
---

This skill is delivered by the `UserPromptSubmit` hook
`hooks/caveman-mode-tracker.js`, which uses `hooks/caveman-stats.js` to read
`model_complete` usage records from `~/.zcode/cli/agents/sess_*/agent_*/transcript.jsonl`.

When the prompt is `/caveman-stats` (optionally `--lifetime`, `--all`, or `--share`),
the hook returns `continue: false` with the formatted stats as the `reason`, so
the host prints the numbers and the model never runs. Flags:
- `--lifetime` / `--all` — union every session dir, not just the newest.
- `--share` — one-line summary (`⛏ Session: N tokens saved (~X%) via caveman mode`).

Input/output/cache figures come straight from `payload.usage`; only the
`Baseline` line is estimated (output × 2.86, the caveman compression factor).
