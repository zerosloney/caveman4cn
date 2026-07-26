# caveman-stats

Real session token receipts. No AI estimation.

## What it does

Reads ZCode session logs directly and reports actual input/output token usage plus estimated savings versus a non-caveman baseline. Numbers come from the JSONL transcripts on disk (`~/.zcode/cli/agents/sess_*/agent_*/transcript.jsonl`, `model_complete` records' `payload.usage`) — the model itself does not compute or estimate them. Output is produced by the `caveman-mode-tracker` `UserPromptSubmit` hook, which intercepts `/caveman-stats` and returns the formatted stats via `continue: false` + `reason`.

Each run also writes a lifetime-savings file (`~/.caveman/lifetime-saved.json`) that a statusline badge can read (`⛏ 12.4k`).

## How to invoke

```
/caveman-stats
```

## Example output

```
Session: 47 turns
Input:   12,304 tokens
Output:   3,891 tokens (caveman)
Baseline: 11,247 tokens (estimated without caveman)
Saved:    7,356 tokens (~65%)
```

## See also

- [`SKILL.md`](./SKILL.md) — hook contract and mechanics
- [Caveman README](../../README.md) — repo overview
