# Caveman Plugin for Cline

Cline SDK Plugin implementing full caveman mode with lifecycle hooks.

## Features

- **Mode Activation**: Auto-activate caveman mode on run start
- **Mode Tracking**: Parse `/caveman` commands and natural language activation
- **Always-on Rules**: Register compression rules into the system prompt (via the `rules` capability)
- **Dangerous Operation Blocking**: Intercept `rm -rf /`, system file writes, etc. (skip the tool call)
- **Token Statistics**: Record per-run token usage via SDK hooks, persist session/lifetime stats
- **Output Quality Check**: Warn on verbose output (log-only; the SDK cannot re-block a finished run)

## Installation

```bash
# From this directory
cline plugin install ./plugins/caveman/hooks/cline

# From git
cline plugin install --git https://github.com/zerosloney/caveman4cn.git

# Via npm (after publishing)
cline plugin install --npm @master0071/caveman-cline
```

Or use the install script:

```bash
node scripts/install-cline.js --plugin    # Install plugin
node scripts/install-cline.js             # Install rules + skills only (Phase 1)
```

## Hook Stages

The plugin implements the `@cline/sdk` `AgentRuntimeHooks` hook bag:

| Stage | Function |
|-------|----------|
| `setup` | Register `caveman_stats` tool + always-on rule |
| `beforeRun` | Reset per-run session stats, activate default mode |
| `beforeModel` | Parse `/caveman` commands, track mode, inject stats |
| `beforeTool` | Block dangerous operations (rm -rf, system writes) |
| `afterRun` | Record token usage, persist stats, output quality check |

> The SDK has no `sessionStart`/`sessionShutdown`/`runEnd` hooks — session scope
> maps to a single `run()`/`continue()` boundary, and the output-quality check is
> log-only (the SDK's `stop` control aborts the whole run, which is not the
> desired "please compress" behavior).

## Data Directory

Plugin state stored in `~/.caveman/cline/`:

- `active` — current mode flag
- `active.prev` — previous mode (for independent mode restore)
- `mode-log.jsonl` — mode transition history
- `lifetime-saved.json` — lifetime token savings
- `session-snapshot.json` — current session stats

## Tools

- `caveman_stats` — Show token usage and estimated savings

## Phase 1 vs Phase 2

- **Phase 1** (Rules + Skills): No hooks, compression via rules only
- **Phase 2** (this plugin): Full hooks, mode tracking, stats, safety checks
