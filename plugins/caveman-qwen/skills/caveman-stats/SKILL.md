---
name: caveman-stats
description: >
  Show real token usage and estimated savings for the current session.
  Reads directly from the Qwen Code session logs — no AI estimation.
  Triggers on /caveman-stats. Output is produced by the user-prompt hook;
  the model itself does not compute the numbers.
  中文触发：用户说"token 统计""省了多少""会话用量"，或调用 /caveman-stats 时触发。
---

本技能由 `UserPromptSubmit` hook `hooks/user-prompt.js` 提供，它调用 `hooks/caveman-stats.js` 读取 Qwen Code 会话记录。

会话日志定位策略（按优先级）：
1. **hook stdin 的 `transcript_path` 字段**（最可靠）——Qwen Code 的 hook 通用字段直接指向当前会话日志文件，`/caveman-stats` 时优先用它。
2. **候选目录探测**——`~/.qwen/{projects,sessions,logs,logs/openai,transcripts,history}/`，覆盖 issue #628（`sessions/<ID>.json`）、issue #362（`logs/openai`）、Claude-Code 风格（`projects/<encoded>/<id>.jsonl`）。
3. 同时支持 `.jsonl`（逐行）和 `.json`（整文件，递归查找 usage 记录）两种格式。

当 prompt 为 `/caveman-stats`（可选 `--lifetime`、`--all`、`--share`）时，hook 返回 `continue: false` 并把格式化后的统计作为 `reason`，所以宿主打印数字，模型不运行。Flags：
- `--lifetime` / `--all` —— 合并所有找到的记录，不只是当前会话。
- `--share` —— 一行摘要（`⛏ Session: N tokens saved (~X%) via caveman mode`）。

Input/output/cache 数字直接取自会话记录的 `usage` 字段；只有 `Baseline` 行是估算的（output × 2.86，即 caveman 压缩系数）。Qwen Code 的会话记录 schema 未完全公开，所以 usage 提取是防御性的——它匹配 Anthropic 风格（`inputTokens`/`outputTokens`）与 OpenAI 风格（`prompt_tokens`/`completion_tokens`），并尝试多种记录形状（`function_call.providerData.rawUsage`、`model_complete.payload.usage`、`assistant.message.usage`、顶层 `usage`），对 `.json` 文件还会递归遍历嵌套结构。如果找不到任何日志文件或其中没有 usage 记录，hook 报告 "No Qwen Code session log found yet."。
