# Caveman Plugin for Cline

Cline SDK Plugin implementing full caveman mode with lifecycle hooks.

## Features

- **Session Start**: Auto-activate caveman mode, inject compression rules
- **Mode Tracking**: Parse `/caveman` commands and natural language activation
- **Dangerous Operation Blocking**: Intercept `rm -rf /`, system file writes, etc.
- **Token Statistics**: Track usage via SDK hooks, persist session/lifetime stats
- **Output Quality Check**: Block verbose output, request compression (max 3 blocks)

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

| Stage | Function |
|-------|----------|
| `sessionStart` | Activate caveman mode, inject SKILL.md rules |
| `beforeAgentStart` | Parse commands, track mode, reinforce rules |
| `toolCallBefore` | Block dangerous operations (rm -rf, system writes) |
| `toolCallAfter` | Record token usage from SDK events |
| `runEnd` | Check output verbosity, persist stats |
| `sessionShutdown` | Persist lifetime stats, reset session |

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
