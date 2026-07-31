# caveman-commit

简短的 Conventional Commits。讲 why 不讲 what。

## 它做什么

生成 Conventional Commits 格式的 commit message。标题 ≤50 字符，硬上限 72。祈使语气。仅当 *why* 不显而易见或有破坏性变更时才加正文。无 AI 署名，无 "this commit does X"，无 emoji（除非项目使用）。破坏性变更、安全修复、数据迁移和回退——正文始终必需，未来的调试者需要上下文。

只输出 message。不暂存、不 commit、不 amend。

## 如何调用

```
/caveman-commit
```

也会在 "write a commit"、"commit message"、"generate commit" 等短语时触发。

## 示例输出

Diff：新增用户 profile 端点。

```
feat(api): add GET /users/:id/profile

Mobile client needs profile data without the full user payload
to reduce LTE bandwidth on cold-launch screens.

Closes #128
```

Diff：破坏性 API 重命名。

```
feat(api)!: rename /v1/orders to /v1/checkout

BREAKING CHANGE: clients on /v1/orders must migrate to /v1/checkout
before 2026-06-01. Old route returns 410 after that date.
```

## 另见

- [`SKILL.md`](./SKILL.md) —— 完整的面向 LLM 的指令
- [Caveman README](../../README.md) —— 仓库总览
