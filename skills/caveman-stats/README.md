# caveman-stats

真实会话 token 凭据。无 AI 估算。

## 它做什么

直接读取当前会话日志，报告实际 turns / input / output token 用量。这三项来自磁盘上的 JSONL 会话日志——模型本身不计算也不估算。输出由 hook 注入，它拦截 `/caveman-stats` 并把格式化后的统计作为 blocked-decision 的 reason 返回。

`Est. saved` 是**估算，不是测量**。没有非 caveman 对照组：它假设啰嗦风格的 output 会长 2.86 倍，因此恒等于上面 output 的 1.86 倍，与回复实际有多简短无关。旧版还显示一个 `~65%` 节省率——那个百分比在代数上会约掉 output，每次会话都是同一个数，已移除。

每次运行还写入一个累计节省的后缀文件，状态栏徽章（`💰 12.4k`）会用到。同样是估算。

## 如何调用

```
/caveman-stats
```

## 示例输出

```
Session: 47 turns
Input:      12,304 tokens
Output:     3,891 tokens
Est. saved: 7,237 tokens

Turns, input and output are read from the session log. "Est. saved" is not
measured: it assumes verbose output would run 2.86x longer, so it is
always 1.86x the output above no matter how terse the replies really were.
```

## 另见

- [`SKILL.md`](./SKILL.md) —— hook 契约与机制
- [Caveman README](../../README.md) —— 仓库总览
