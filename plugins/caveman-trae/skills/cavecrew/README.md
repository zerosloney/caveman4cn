# cavecrew

决策指南。何时委派给 caveman 子代理而非自己在线处理。

## 它做什么

告诉主线程何时 spawn caveman 风格子代理，何时用原版等价物。收益：子代理的 tool-result 逐字注入主上下文，而 caveman 输出大约只有原版散文的 1/3 大小。一次会话 20 次委派下来，这就是上下文耗尽和完成任务之间的差别。

三个子代理：

| 子代理 | 职能 | 何时用 |
|----------|-----|----------|
| `cavecrew-investigator` | 定位代码（只读） | "X 在哪定义 / 什么调用 Y / 列出 Z 的所有用法" |
| `cavecrew-builder` | 外科手术式编辑，1-2 文件 | 范围清晰，≤2 文件。拒绝 3+ 文件范围。 |
| `cavecrew-reviewer` | diff/文件审查 | 一行发现带严重度 emoji |

需要散文、架构点评或理据时用原版 `Explore` 或 `Code Reviewer`。一行答案和 3+ 文件重构直接用主线程。

本技能是决策指南，不是 slash 命令。对话提到委派时激活。

## 如何调用

在 "delegate to subagent"、"use cavecrew"、"spawn investigator"、"save context"、"compressed agent output" 等短语时触发。

## 示例链式

定位 → 修复 → 验证（最常见）：

1. `cavecrew-investigator` 返回位置列表（`path:line — symbol — note`）
2. 主线程选 1-2 处，把路径交给 `cavecrew-builder`
3. `cavecrew-reviewer` 审计生成的 diff

并行侦察：在一条消息里 spawn 2-3 个 `cavecrew-investigator` 调用，不同角度（定义、调用方、测试）。在主线程聚合。

## 模型覆盖

默认情况下，`cavecrew-reviewer` 和 `cavecrew-investigator` 在 frontmatter 里钉 `model: haiku`；`cavecrew-builder` 无 `model:` 行（用 API 会话默认）。启动 Claude Code 前在 shell 里设置环境变量可按代理覆盖：

| 环境变量 | 代理 |
|---|---|
| `CAVECREW_REVIEWER_MODEL` | `cavecrew-reviewer` |
| `CAVECREW_BUILDER_MODEL` | `cavecrew-builder` |
| `CAVECREW_INVESTIGATOR_MODEL` | `cavecrew-investigator` |

示例——reviewer 跑 sonnet，其余保持默认：

```sh
export CAVECREW_REVIEWER_MODEL=sonnet
```

用你在任何 Claude Code agent frontmatter 里会用的同款模型名字符串（如 `haiku`, `sonnet`, `opus`）。

覆盖只改已安装 agent frontmatter 里的 `model:` 行；prompt 正文不动，继续接收上游更新。仅插件安装有效——独立 hook 安装没有本地 agent 文件可改。取消设置或留空 = 不变。补丁在已安装文件里持续有效，直到插件更新或重装。

## 另见

- [`SKILL.md`](./SKILL.md) —— 完整决策矩阵和输出契约
- [`agents/cavecrew-investigator.md`](../../agents/cavecrew-investigator.md)
- [`agents/cavecrew-builder.md`](../../agents/cavecrew-builder.md)
- [`agents/cavecrew-reviewer.md`](../../agents/cavecrew-reviewer.md)
- [Caveman README](../../README.md) —— 仓库总览
