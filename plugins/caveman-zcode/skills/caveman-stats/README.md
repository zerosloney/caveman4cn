# caveman-stats

真实会话 token 凭据。无 AI 估算。

## 它做什么

直接读取 ZCode 会话日志，报告实际 input/output token 用量，并对照非 caveman 基线估算节省量。数字来自磁盘上的 JSONL 会话记录（`~/.zcode/cli/agents/sess_*/agent_*/transcript.jsonl`，`model_complete` 记录的 `payload.usage`）——模型本身不计算也不估算。输出由 `caveman-mode-tracker` 的 `UserPromptSubmit` hook 产生，它拦截 `/caveman-stats` 并通过 `continue: false` + `reason` 返回格式化后的统计。

每次运行还写入一个累计节省文件（`~/.caveman/lifetime-saved.json`），状态栏徽章可读取（`⛏ 12.4k`）。

## 如何调用

```
/caveman-stats
```

## 示例输出

```
Session: 47 turns
Input:   12,304 tokens
Output:   3,891 tokens (caveman)
Baseline: 11,247 tokens (estimated without caveman)
Saved:    7,356 tokens (~65%)
```

## 另见

- [`SKILL.md`](./SKILL.md) —— hook 契约与机制
- [Caveman README](../../README.md) —— 仓库总览
