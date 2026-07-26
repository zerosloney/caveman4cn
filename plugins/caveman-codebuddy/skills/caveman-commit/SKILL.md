---
name: caveman-commit
description: >
  Ultra-compressed commit message generator. Cuts noise from commit messages while preserving
  intent and reasoning. Conventional Commits format. Subject ≤50 chars, body only when "why"
  isn't obvious. Use when user says "write a commit", "commit message", "generate commit",
  "/commit", or invokes /caveman-commit. Auto-triggers when staging changes.
  中文触发：用户说"写提交信息""commit message""生成 commit""提交信息"，或调用 /caveman-commit、暂存改动时触发。
---

写 commit message 要简短精准。Conventional Commits 格式。无废话。讲 why 不讲 what。

## 规则

**标题行：**
- `<type>(<scope>): <imperative summary>` —— `<scope>` 可选
- 类型：`feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `build`, `ci`, `style`, `revert`
- 祈使语气："add", "fix", "remove" —— 不是 "added", "adds", "adding"
- 尽量 ≤50 字符，硬上限 72
- 无结尾句号
- 冒号后大小写遵循项目约定

**正文（仅在需要时）：**
- 标题已自明时整个跳过
- 仅在以下情况加正文：非显而易见的 *why*、破坏性变更、迁移说明、关联 issue
- 72 字符换行
- 用 `-` 不用 `*`
- 在末尾引用 issue/PR：`Closes #42`, `Refs #17`

**绝不写入：**
- "This commit does X", "I", "we", "now", "currently" —— diff 已说明 what
- "As requested by..." —— 用 Co-authored-by trailer
- "Generated with Claude Code" 或任何 AI 署名 —— 除非用户自己的规则要求 `Assisted-by`/AI 署名 trailer，此时作为 trailer 加入
- emoji（除非项目约定要求）
- scope 已说明时重复陈述文件名

## 示例

Diff: 新增用户 profile 端点，正文解释 why
- ❌ "feat: add a new endpoint to get user profile information from the database"
- ✅
  ```
  feat(api): add GET /users/:id/profile

  Mobile client needs profile data without the full user payload
  to reduce LTE bandwidth on cold-launch screens.

  Closes #128
  ```

Diff: 破坏性 API 变更
- ✅
  ```
  feat(api)!: rename /v1/orders to /v1/checkout

  BREAKING CHANGE: clients on /v1/orders must migrate to /v1/checkout
  before 2026-06-01. Old route returns 410 after that date.
  ```

## 自动清晰化

以下情况始终包含正文：破坏性变更、安全修复、数据迁移、任何回退先前 commit 的操作。绝不把这些压成只有标题——未来的调试者需要上下文。

## 边界

只生成 commit message。不运行 `git commit`，不暂存文件，不 amend。把 message 作为可粘贴的代码块输出。"stop caveman-commit" 或 "normal mode"：回退到冗长 commit 风格。
