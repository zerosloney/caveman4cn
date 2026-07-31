# caveman-review

一行 PR 评论。位置，问题，修复。无开场寒暄。

## 它做什么

生成 `L<line>: <severity> <problem>. <fix>.` 格式的代码审查评论。每条发现一行。严重度 emoji：🔴 bug, 🟡 risk, 🔵 nit, ❓ question。删除 "I noticed that..."、对冲、以及复述 diff 已展示的内容。保留精确行号、反引号符号和具体修复。

自动清晰化：CVE 级安全发现、架构分歧、作者需要 *why* 的上手场景下，放弃简短模式。其余部分恢复简短。

仅输出——不 approve、不 request changes、不运行 linter。

## 如何调用

```
/caveman-review
```

也会在 "review this PR"、"code review"、"review the diff" 时触发。

## 示例输出

```
L42: 🔴 bug: user can be null after .find(). Add guard before .email.
L88-140: 🔵 nit: 50-line fn does 4 things. Extract validate/normalize/persist.
L23: 🟡 risk: no retry on 429. Wrap in withBackoff(3).
L107: ❓ q: why drop the cache here? Reads on next request will miss.
```

## 另见

- [`SKILL.md`](./SKILL.md) —— 完整的面向 LLM 的指令
- [Caveman README](../../README.md) —— 仓库总览
