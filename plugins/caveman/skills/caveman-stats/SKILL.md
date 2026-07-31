---
name: caveman-stats
description: >
  Show real token usage and estimated savings for the current session.
  Reads directly from the Claude Code session log — no AI estimation.
  Triggers on /caveman-stats. Output is injected by the mode-tracker hook;
  the model itself does not compute the numbers.
  中文触发：用户说"token 统计""省了多少""会话用量"，或调用 /caveman-stats 时触发。
---

本技能由 `hooks/caveman-stats.js` 提供（`hooks/caveman-mode-tracker.js` 在 `/caveman-stats` 时读取它）。本技能触发时模型无需做任何事——hook 返回 `decision: "block"`，并把格式化后的统计作为 reason。用户立即看到数字。
