---
description: 把常驻 caveman 激活规则写入本仓库的 AGENTS.md
argument-hint: "[--dry-run|--force]"
---

Write the caveman activation rule into this repo's `AGENTS.md` (or `QWEN.md`) so every Qwen Code session auto-loads caveman mode — no per-session `/caveman` prompt needed. Qwen Code reads `AGENTS.md` / `QWEN.md` on every session start.

How to run:

1. If the extension is installed, the tool ships at `${extensionPath}/tools/caveman-init.js`. Run:
   ```
   node "${extensionPath}/tools/caveman-init.js" $ARGUMENTS
   ```
2. Otherwise run the checked-out local script:
   ```
   node "<repo>/plugins/caveman/tools/caveman-init.js" $ARGUMENTS
   ```

   Do not pipe an unpinned remote script into `node`.

The script is idempotent — safe to re-run. It appends the rule block to `AGENTS.md` (creating the file if absent) and skips if the caveman sentinel is already present.

The command defaults to `--dry-run`; pass `--force` only after user confirmation to write. Existing sentinel blocks remain skipped. Report the result (added / appended / skipped).
