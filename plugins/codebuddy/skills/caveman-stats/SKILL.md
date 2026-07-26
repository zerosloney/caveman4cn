---
name: caveman-stats
description: >
  Show real token usage and estimated savings for the current session.
  Reads directly from the CodeBuddy session logs — no AI estimation.
  Triggers on /caveman-stats. Output is produced by the mode-tracker hook;
  the model itself does not compute the numbers.
---

This skill is delivered by the `UserPromptSubmit` hook
`hooks/caveman-mode-tracker.js`, which uses `hooks/caveman-stats.js` to read
CodeBuddy session transcripts from
`~/.codebuddy/projects/<project>/<uuid>.jsonl`.

When the prompt is `/caveman-stats` (optionally `--lifetime`, `--all`, or `--share`),
the hook returns `continue: false` with the formatted stats as the `reason`, so
the host prints the numbers and the model never runs. Flags:
- `--lifetime` / `--all` — union every project's transcripts, not just the newest.
- `--share` — one-line summary (`⛏ Session: N tokens saved (~X%) via caveman mode`).

Input/output/cache figures come straight from the transcript `usage` records;
only the `Baseline` line is estimated (output × 2.86, the caveman compression
factor). CodeBuddy's transcript record schema is not publicly documented, so
usage extraction is defensive — it matches the common `payload.usage` shape and
falls back to any record carrying a top-level `usage` object. If no usage
records are found, the hook reports "No session log found yet."
