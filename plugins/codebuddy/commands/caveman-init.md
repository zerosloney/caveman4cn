---
description: Drop the always-on caveman activation rule into the current repo for every IDE agent
argument-hint: "[--dry-run|--force] [--only <agent>]"
---

Write the per-repo caveman rule files (Cursor, Windsurf, Cline, Copilot, AGENTS.md) into the current repo, then report the result.

Run the init script from the plugin's tools directory:
`node ~/.codebuddy/plugins/codebuddy-caveman/tools/caveman-init.js $ARGUMENTS`

Use --dry-run first if the user did not pass --force.