---
description: Drop the always-on caveman activation rule into this repo's AGENTS.md. 中文：把常驻 caveman 激活规则写入本仓库的 AGENTS.md
argument-hint: "[--dry-run|--force]"
---

Write the caveman activation rule into this repo's `AGENTS.md` so every CodeBuddy session auto-loads caveman mode — no per-session `/caveman` prompt needed. CodeBuddy reads `AGENTS.md` on every session start.

How to run:

1. If the plugin is installed, the tool ships at `${CODEBUDDY_PLUGIN_ROOT}/tools/caveman-init.js`. Run:
   ```
   node "${CODEBUDDY_PLUGIN_ROOT}/tools/caveman-init.js" $ARGUMENTS
   ```
2. Otherwise run standalone (self-contained, supports stdin execution):
   ```
   curl -fsSL https://raw.githubusercontent.com/zerosloney/caveman4cn/main/plugins/caveman-codebuddy/tools/caveman-init.js | node - $ARGUMENTS
   ```

The script is idempotent — safe to re-run. It appends the rule block to `AGENTS.md` (creating the file if absent) and skips if the caveman sentinel is already present.

Use `--dry-run` first if the user did not pass `--force`, so we never silently overwrite an existing rule block. Report the result (added / appended / skipped).
