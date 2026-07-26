---
name: caveman-stats
description: >
  Show real token usage and estimated savings for the current session.
  Reads directly from the CodeBuddy session logs — no AI estimation.
  Triggers on /caveman-stats. Output is produced by the mode-tracker hook;
  the model itself does not compute the numbers.
  中文触发：用户说"token 统计""省了多少""会话用量"，或调用 /caveman-stats 时触发。
---

本技能由 `UserPromptSubmit` hook `hooks/caveman-mode-tracker.js` 提供，它用 `hooks/caveman-stats.js` 从 `~/.codebuddy/projects/<project>/<uuid>.jsonl` 读取 CodeBuddy 会话记录。

当 prompt 为 `/caveman-stats`（可选 `--lifetime`、`--all`、`--share`）时，hook 返回 `continue: false` 并把格式化后的统计作为 `reason`，所以宿主打印数字，模型不运行。Flags：
- `--lifetime` / `--all` —— 合并每个 project 的记录，不只是最新的。
- `--share` —— 一行摘要（`⛏ Session: N tokens saved (~X%) via caveman mode`）。

Input/output/cache 数字直接取自会话记录的 `usage` 记录；只有 `Baseline` 行是估算的（output × 2.86，即 caveman 压缩系数）。CodeBuddy 的会话记录 schema 未公开，所以 usage 提取是防御性的——它匹配常见的 `payload.usage` 形状，并回退到任何带顶层 `usage` 对象的记录。如果找不到 usage 记录，hook 报告 "No session log found yet."。
