---
description: Drop the always-on caveman activation rule into the current repo
argument-hint: "[--dry-run|--force]"
---

Write the always-on caveman activation rule into AGENTS.md in the current repo, then report the result.

Append or update the `@./skills/` entries in AGENTS.md to reference the caveman skills.
Use `--dry-run` first if the user did not pass `--force`, so we never silently overwrite an existing rule file.