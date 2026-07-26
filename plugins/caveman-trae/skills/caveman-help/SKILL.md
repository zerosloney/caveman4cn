---
name: caveman-help
description: >
  Quick-reference card for all caveman modes, skills, and commands.
  One-shot display, not a persistent mode. Trigger: /caveman-help,
  "caveman help", "what caveman commands", "how do I use caveman".
  中文触发：用户说"caveman 帮助""有哪些命令""速查卡""怎么用 caveman"，或调用 /caveman-help 时触发。
---

# Caveman Help

被调用时显示这张参考卡。一次性——不要切换模式、不要写 flag 文件、不要持久化任何东西。以 caveman 风格输出。

## 模式

| 模式 | 触发 | 改变什么 |
|------|---------|-------------|
| **Lite** | `/caveman lite` | 删填充词。保留句子结构。 |
| **Full** | `/caveman` | 删冠词、填充、客套、对冲。片段可用。默认。 |
| **Ultra** | `/caveman ultra` | 极致压缩。裸片段。表格优先于散文。 |
| **Wenyan-Lite** | `/caveman wenyan-lite` | 文言文体，轻度压缩。 |
| **Wenyan-Full** | `/caveman wenyan` | 完全文言文。最大古典简洁度。 |
| **Wenyan-Ultra** | `/caveman wenyan-ultra` | 极致。预算吃紧的古代书生。 |

模式持续直到被更改或会话结束。

## 技能

| 技能 | 触发 | 做什么 |
|-------|---------|-----------|
| **caveman-commit** | `/caveman-commit` | 简短 commit message。Conventional Commits。≤50 字符标题。 |
| **caveman-review** | `/caveman-review` | 一行 PR 评论：`L42: bug: user null. Add guard.` |
| **caveman-compress** | `/caveman-compress <file>` | 把 .md 文件压缩成 caveman 散文。省约 46% input token。 |
| **caveman-help** | `/caveman-help` | 本卡。 |

## 停用

说 "stop caveman" 或 "normal mode"。随时用 `/caveman` 恢复。

## 语言

默认保留用户语言。用户写葡萄牙语 → 用葡萄牙语 caveman 回复。压缩风格，不压缩语言。技术术语、代码、命令、commit 类型、精确错误串逐字保留，除非用户要求翻译。

## 配置默认模式

默认模式 = `full`。可更改：

**环境变量**（最高优先级）：
```bash
export CAVEMAN_DEFAULT_MODE=ultra
```

**配置文件**（`~/.config/caveman/config.json`）：
```json
{ "defaultMode": "lite" }
```

设为 `"off"` 可在会话启动时禁用自动激活。用户仍可用 `/caveman` 手动激活。

解析顺序：环境变量 > 配置文件 > `full`。

## Trae 安装

caveman-trae 通过安装器铺到 `~/.trae-cn/`：
- skills → `~/.trae-cn/skills/`
- commands → `~/.trae-cn/commands/`
- hooks + helpers → `~/.trae-cn/caveman-trae/hooks/`
- `~/.trae-cn/hooks.json` 合并 5 个事件（SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop）

安装：`node scripts/install-trae.js`。

## 更多

完整文档：https://github.com/zerosloney/caveman4cn
