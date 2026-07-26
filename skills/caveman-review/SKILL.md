---
name: caveman-review
description: >
  Ultra-compressed code review comments. Cuts noise from PR feedback while preserving
  the actionable signal. Each comment is one line: location, problem, fix. Use when user
  says "review this PR", "code review", "review the diff", "/review", or invokes
  /caveman-review. Auto-triggers when reviewing pull requests.
  中文触发：用户说"代码审查""review PR""评审代码""review diff"，或调用 /caveman-review、审查 PR 时触发。
---

写代码审查评论要简短可操作。每条发现一行。位置，问题，修复。无开场寒暄。

## 规则

**格式：** `L<line>: <problem>. <fix>.` —— 或审查多文件 diff 时用 `<file>:L<line>: ...`。

**严重度前缀（可选，混合时使用）：**
- `🔴 bug:` —— 行为损坏，会引发事故
- `🟡 risk:` —— 能跑但脆弱（竞态、缺 null 检查、吞错误）
- `🔵 nit:` —— 风格、命名、微优化。作者可忽略
- `❓ q:` —— 真实提问，不是建议

**删除：**
- "I noticed that...", "It seems like...", "You might want to consider..."
- "This is just a suggestion but..." —— 用 `nit:` 代替
- "Great work!", "Looks good overall but..." —— 在顶部说一次，不要每条评论都重复
- 复述该行做什么 —— 审查者能读 diff
- 对冲（"perhaps", "maybe", "I think"）—— 不确定就用 `q:`

**保留：**
- 精确行号
- 反引号包裹的精确符号/函数/变量名
- 具体修复，不是 "consider refactoring this"
- 如果修复从问题描述看不出来，补上 *why*

## 示例

❌ "I noticed that on line 42 you're not checking if the user object is null before accessing the email property. This could potentially cause a crash if the user is not found in the database. You might want to add a null check here."

✅ `L42: 🔴 bug: user can be null after .find(). Add guard before .email.`

❌ "It looks like this function is doing a lot of things and might benefit from being broken up into smaller functions for readability."

✅ `L88-140: 🔵 nit: 50-line fn does 4 things. Extract validate/normalize/persist.`

❌ "Have you considered what happens if the API returns a 429? I think we should probably handle that case."

✅ `L23: 🟡 risk: no retry on 429. Wrap in withBackoff(3).`

## 自动清晰化

以下情况放弃简短模式：安全发现（CVE 级 bug 需要完整解释 + 参考）、架构分歧（需要理据而非一行话）、作者新手需要 *why* 的上手场景。这些情况写正常段落，其余部分恢复简短。

## 边界

仅审查——不写代码修复，不 approve/request-changes，不运行 linter。输出可粘贴进 PR 的评论。"stop caveman-review" 或 "normal mode"：回退到冗长审查风格。
