---
name: caveman-stats
description: >
  Show real token usage and estimated savings for the current session.
  Reads directly from the Trae session logs — no AI estimation.
  Triggers on /caveman-stats. Output is produced by the user-prompt hook;
  the model itself does not compute the numbers.
  中文触发：用户说"token 统计""省了多少""会话用量"，或调用 /caveman-stats 时触发。
---

本技能由 `UserPromptSubmit` hook `hooks/user-prompt.js` 提供，它用 `hooks/caveman-stats.js` 从 Trae 会话记录读取 token 用量。

Trae 的会话记录目录未在官方文档中公开，因此 `caveman-stats.js` 探测多个候选路径：
- `~/.trae-cn/`（Trae 中文版默认全局目录）
- `~/.trae/`（Trae 国际版候选）
- `%APPDATA%/Trae*/`、`%APPDATA%/trae*/`（Windows 应用数据候选）
- `$XDG_DATA_HOME/trae*/`（Linux 候选）

在这些目录下递归查找 `.jsonl` 会话记录（取最近修改的非空文件）。

当 prompt 为 `/caveman-stats`（可选 `--lifetime`、`--all`、`--share`）时，hook 返回 `decision: "block"` 并把格式化后的统计作为 `reason`，所以 Trae 打印数字，模型不运行。Flags：
- `--lifetime` / `--all` —— 合并所有候选目录下的记录，不只是最新的。
- `--share` —— 一行摘要（`⛏ Session: N tokens saved (~X%) via caveman mode`）。

Input/output/cache 数字直接取自会话记录的 `usage` 记录（防御式解析，匹配 `payload.usage`、`providerData.rawUsage`、顶层 `usage` 等多种形状）；只有 `Baseline` 行是估算的（output × 2.86，即 caveman 压缩系数）。如果找不到 usage 记录，hook 报告 "No Trae session log found yet. Run a few turns, then /caveman-stats again."。
