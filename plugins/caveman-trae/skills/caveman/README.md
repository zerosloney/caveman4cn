# caveman

像聪明的穴居人一样说话。同样的脑子，更少的 token。

## 它做什么

把每个模型回复压缩成 caveman 风格散文。删除冠词、填充词、客套和对冲。保留每个技术细节、代码块、错误串和符号精确。在完整保真下削减 65% 输出 token（实测）。模式持续整个会话，直到被更改或停止。

六个强度级别：

| 级别 | 改变什么 |
|-------|-------------|
| `lite` | 删填充/对冲。句子保持完整。专业但紧凑。 |
| `full` | 默认。删冠词，片段可用，短同义词。 |
| `ultra` | 裸片段。缩写（DB, auth, fn）。因果用箭头。 |
| `wenyan-lite` | 文言文语域，轻度压缩。 |
| `wenyan-full` | 最大文言文。80-90% 字符削减。 |
| `wenyan-ultra` | 极致古典压缩。 |

自动清晰化规则：caveman 在安全警告、不可逆操作确认、片段歧义会引发误读的多步序列、以及用户重复提问时，降为正常散文。清晰部分讲完后恢复。

## 如何调用

```
/caveman              # full 模式（默认）
/caveman lite         # 轻度压缩
/caveman ultra        # 极致压缩
/caveman wenyan       # 文言文
stop caveman          # 回正常散文
```

## 示例输出

问题："Why does my React component re-render?"

正常散文：
> Your component re-renders because you create a new object reference each render. Wrapping it in `useMemo` will fix the issue.

Caveman (full)：
> New object ref each render. Inline object prop = new ref = re-render. Wrap in `useMemo`.

Caveman (ultra)：
> Inline obj prop → new ref → re-render. `useMemo`.

## 另见

- [`SKILL.md`](./SKILL.md) —— 完整的面向 LLM 的指令
- [Caveman README](../../README.md) —— 仓库总览、安装、benchmark
