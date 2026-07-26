---
description: Drop the always-on caveman activation rule into the current repo. 中文：把常驻 caveman 激活规则写入当前仓库
argument-hint: "[--dry-run|--force]"
---

Write the caveman activation rule into this repo's `AGENTS.md` so every ZCode session auto-loads caveman mode — no per-session `/caveman` prompt needed. ZCode reads `AGENTS.md` on every session start.

How to run:

1. If the plugin is installed, the tool ships at `${ZCODE_PLUGIN_ROOT}/tools/caveman-init.js`. Run:
   ```
   node "${ZCODE_PLUGIN_ROOT}/tools/caveman-init.js" $ARGUMENTS
   ```
2. Otherwise run standalone (self-contained, supports stdin execution):
   ```
   curl -fsSL https://raw.githubusercontent.com/zerosloney/caveman4cn/main/plugins/caveman-zcode/tools/caveman-init.js | node - $ARGUMENTS
   ```

The script is idempotent — safe to re-run. It appends the rule block to `AGENTS.md` (creating the file if absent) and skips if the caveman sentinel is already present.

Use `--dry-run` first if the user did not pass `--force`, so we never silently overwrite an existing rule block. Report the result (added / appended / skipped).
