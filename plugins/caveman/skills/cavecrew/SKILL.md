---
name: cavecrew
description: >
  Decision guide for delegating to caveman-style subagents. Tells the main
  thread WHEN to spawn `cavecrew-investigator` (locate code), `cavecrew-builder`
  (1-2 file edit), or `cavecrew-reviewer` (diff review) instead of doing the
  work inline or using vanilla `Explore`. Subagent output is caveman-compressed
  so the tool-result injected back into main context is ~60% smaller — main
  context lasts longer across long sessions.
  Trigger: "delegate to subagent", "use cavecrew", "spawn investigator/builder/reviewer",
  "save context", "compressed agent output".
  中文触发：用户说"委派子代理""用 cavecrew""spawn investigator/builder/reviewer""节省上下文""压缩代理输出"时触发。
---

Cavecrew = 三个输出 caveman 内容的子代理预设。职能同 Anthropic 默认（`Explore`、编辑型代理、reviewer）；区别在于它们返回的 tool-result 是压缩过的，所以每次委派都缩小主上下文。

## 何时用 cavecrew vs 替代方案

| 任务 | 用 |
|---|---|
| "X 在哪定义 / 什么调用 Y / 列出 Z 的所有用法" | `cavecrew-investigator` |
| 同上但你还想要建议/架构点评 | `Explore`（原版） |
| 外科手术式编辑，≤2 文件，范围清晰 | `cavecrew-builder` |
| 新功能 / 3+ 文件 / 跨文件重构 | 主线程或 `feature-dev:code-architect` |
| 审查 diff、分支或文件找 bug | `cavecrew-reviewer` |
| 需要理据 + 备选方案的深度代码审查 | `Code Reviewer`（原版） |
| 你已经知道的一行答案 | 主线程，不委派 |

经验法则：**如果你希望子代理输出只用 1/3 的 token，选 cavecrew。如果你需要散文，选原版。**

## 为什么存在（真正的收益）

子代理的 tool result 会被逐字注入主上下文。原版 `Explore` 返回 2k token 散文，每次都消耗 2k token 的主上下文预算。同样的发现从 `cavecrew-investigator` 返回约 700 token。一次会话 20 次委派下来，这就是上下文耗尽和完成任务之间的差别。

## 输出契约

主线程对每个代理可依赖的输出格式：

**`cavecrew-investigator`**
```
<Header>:
- path:line — `symbol` — short note
totals: <counts>.
```
或 `No match.` 始终文件路径优先、附行号、符号反引号包裹。可用 `path:\d+` grep。

**`cavecrew-builder`**
```
<path:line-range> — <change ≤10 words>.
verified: <re-read OK | mismatch @ path:line>.
```
或以下之一：`too-big.` / `needs-confirm.` / `ambiguous.` / `regressed.`（终止符为首个 token）。

**`cavecrew-reviewer`**
```
path:line: <emoji> <severity>: <problem>. <fix>.
totals: N🔴 N🟡 N🔵 N❓
```
或 `No issues.` 发现按文件 → 行号升序排列。

## 链式模式

**定位 → 修复 → 验证**（最常见）：
1. `cavecrew-investigator` 返回位置列表。
2. 主线程选 1-2 处，把路径交给 `cavecrew-builder`。
3. `cavecrew-reviewer` 审计 diff。

**并行侦察**（调查范围广时）：
在一条消息里 spawn 2-3 个 `cavecrew-investigator` 调用（不同角度：定义 vs 调用方 vs 测试）。在主线程聚合。

**单次编辑**（位置已知时）：
跳过 investigator。把精确的 path:line 直接交给 `cavecrew-builder`。

## 不要做的事

- 不知文件时不要用 `cavecrew-builder`。先 spawn investigator，否则主线程为了传递上下文会吃 token。
- 5 文件重构不要链式 `cavecrew-investigator → cavecrew-builder`。Builder 会返回 `too-big.`，你浪费一回合。
- 不要让 `cavecrew-reviewer` 给"总体反馈"——它只返回发现，不给架构意见。那要用 `Code Reviewer`。
- 不要期待散文。Cavecrew 输出是结构化的，有时简短到隐晦。如果人类要直接读，转述一下。

## 自动清晰化（继承）

子代理在安全警告、不可逆操作确认、以及任何片段歧义可能被误读的输出上，放弃 caveman → 改用正常英文。之后恢复 caveman。
