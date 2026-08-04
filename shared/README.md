# shared/

Single-source-of-truth templates for code that is duplicated across the five
IDE plugin builds (`caveman-{codebuddy,qoder,qwen,trae,zcode}`).

## Why this exists

The five plugins each ship a near-identical `hooks/caveman-config.js`. Hand-syncing
five copies drifted over time (comment typos, missing env hooks, stray blank
lines). This directory holds the **template**; a sync script regenerates the
five plugin copies from it so they can never drift again.

## What lives here

| File | Purpose |
|------|---------|
| `caveman-config.template.js` | The only file you edit. Renders to `plugins/caveman-<id>/hooks/caveman-config.js` for each of the four agents. |

## How to make a change

1. Edit `shared/caveman-config.template.js` — never edit the plugin copies
   directly (a pre-commit hook will reject the commit if you do).
2. Run `npm run sync:shared` to regenerate the four plugin files.
3. Commit the template **and** the four regenerated plugin files together.

If you forget step 2, the pre-commit hook runs sync for you, re-stages the
updated files, and asks you to re-review the diff before re-committing.

## Template syntax

The renderer is deliberately tiny (no dependency on a template engine).

| Construct | Meaning |
|-----------|---------|
| `{{AGENT_ID}}` | Replaced with the unquoted agent id, e.g. `codebuddy`. The template supplies any quoting (`'{{AGENT_ID}}'`). |
| `{{AGENT_LABEL}}` | Replaced with the human label for the header comment, e.g. `CodeBuddy`, `Qwen Code`. |
| `{{#ZCODE_ENV}}...{{/ZCODE_ENV}}` | Conditional block. Kept (with the tags removed) only for the `zcode` build, whose `getCavemanRoot()` honors `process.env.ZCODE_PLUGIN_DATA`. Removed entirely for the other four builds. |

To add a sixth IDE plugin: add an entry to the `AGENTS` array in
`scripts/sync-shared.js` and re-run sync. No template change needed unless the
new agent needs its own env override (in which case add another conditional
block).

## Safety rails

The sync script validates each rendered file three ways before writing:

1. **Placeholder check** — no `{{...}}` may remain (catches typos like
   `{{AGENTID}}`).
2. **Syntax check** — `node --check` must pass (catches the classic
   `''codebuddy''` double-quote bug).
3. **Behavior check** — the module is actually loaded and its key functions
   (`getCavemanRoot`, `getAgentFlagPath`, `AGENT_ID`) must return values of the
   expected type. This catches "syntactically valid but logically broken"
   output, like a missing `return` that `node --check` won't flag.

If any check fails, sync exits with code 2 and writes nothing to the plugin
directory.

## Scope

Only `caveman-config.js` is shared today. The other duplicated files
(`caveman-stats.js`, `stop.js`, `scripts/statusline.js`) have larger per-agent
differences (transcript paths, blocking mechanisms) and stay maintained
per-plugin until a similar pattern is justified.
