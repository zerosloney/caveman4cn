<p align="center">
  <img src="https://em-content.zobj.net/source/apple/391/rock_1faa8.png" width="80" />
</p>

<h1 align="center">caveman-compress</h1>

<p align="center">
  <strong>压缩 memory 文件。每个会话都省 token。</strong>
</p>

---

一个 Claude Code 技能，把项目 memory 文件（`CLAUDE.md`、todos、preferences）压缩成 caveman 格式——让每个会话自动加载更少的 token。

Claude 每次会话启动时读 `CLAUDE.md`。文件大，成本就大。Caveman 把文件变小。成本永久下降。

## 它做什么

```
/caveman-compress CLAUDE.md
```

```
CLAUDE.md          ← 压缩版（Claude 读这个——每个会话更少 token）
CLAUDE.original.md ← 人类可读备份（你编辑这个）
```

原文件永不丢失。你可以读和编辑 `.original.md`。编辑后再次运行技能重新压缩。

## 基准测试

真实项目文件上的真实结果：

| 文件 | 原始 | 压缩后 | 节省 |
|------|----------:|----------:|------:|
| `claude-md-preferences.md` | 706 | 285 | **59.6%** |
| `project-notes.md` | 1145 | 535 | **53.3%** |
| `claude-md-project.md` | 1122 | 636 | **43.3%** |
| `todo-list.md` | 627 | 388 | **38.1%** |
| `mixed-with-code.md` | 888 | 560 | **36.9%** |
| **平均** | **898** | **481** | **46%** |

所有校验通过 ✅ —— 标题、代码块、URL、文件路径逐字保留。

## 压缩前 / 压缩后

<table>
<tr>
<td width="50%">

### 📄 原始（706 tokens）

> "I strongly prefer TypeScript with strict mode enabled for all new code. Please don't use `any` type unless there's genuinely no way around it, and if you do, leave a comment explaining the reasoning. I find that taking the time to properly type things catches a lot of bugs before they ever make it to runtime."

</td>
<td width="50%">

### <img src="../../docs/assets/dancing-rock.svg" width="20" height="20" alt="rock"/> Caveman（285 tokens）

> "Prefer TypeScript strict mode always. No `any` unless unavoidable — comment why if used. Proper types catch bugs early."

</td>
</tr>
</table>

**同样的指令。少 60% token。每。一。次。会话。**

## 安全

`caveman-compress` 因静态分析检测到的子进程和文件 I/O 模式被 Snyk 标为高风险。这是误报——见 [SECURITY.md](./SECURITY.md) 对该技能做与不做什么的完整说明。

## 安装

compress 内置于 `caveman` 插件。安装一次 `caveman`，然后用 `/caveman-compress`。

如果需要本地文件，compress 技能位于：

```bash
caveman-compress/
```

**要求：** Python 3.10+

## 用法

```
/caveman-compress <filepath>
```

示例：
```
/caveman-compress CLAUDE.md
/caveman-compress docs/preferences.md
/caveman-compress todos.md
```

### 哪些文件可用

| 类型 | 压缩？ |
|------|-----------|
| `.md`, `.txt`, `.rst`, `.typ`, `.typst`, `.tex` | ✅ 是 |
| 无扩展名的自然语言 | ✅ 是 |
| `.py`, `.js`, `.ts`, `.json`, `.yaml` | ❌ 跳过（代码/配置） |
| `*.original.md` | ❌ 跳过（备份文件） |

## 工作原理

```
/caveman-compress CLAUDE.md
        ↓
检测文件类型        （不耗 token）
        ↓
Claude 压缩       （耗 token——一次调用）
        ↓
校验输出         （不耗 token）
  检查：标题、代码块、URL、文件路径、列表项
        ↓
出错时：Claude 仅定点修复    （耗 token——针对性修复）
  不重新压缩——只修补损坏部分
        ↓
最多重试 2 次
        ↓
写压缩版 → CLAUDE.md
写原始版 → CLAUDE.original.md
```

只有两件事耗 token：初始压缩 + 校验失败时的针对性修复。其余全是本地 Python。

## 保留了什么

Caveman 只压缩自然语言。绝不触碰：

- 代码块（` ``` ` fenced 或缩进）
- 行内代码（`` `backtick content` ``）
- URL 和链接
- 文件路径（`/src/components/...`）
- 命令（`npm install`, `git commit`）
- 技术术语、库名、API 名
- 标题（精确文本保留）
- 表格（结构保留，单元格文本压缩）
- 日期、版本号、数值

## 为什么这重要

`CLAUDE.md` 在**每次会话启动**时加载。一个 1000-token 的项目 memory 文件，每次打开项目都消耗这么多 token。100 次会话就是 100,000 token 的开销——全是你已经写过的上下文。

Caveman 平均削减约 46%。同样的指令。同样的准确度。更少的浪费。

```
┌────────────────────────────────────────────┐
│  每文件 TOKEN 节省       █████       46% │
│  受益会话数             ██████████ 100% │
│  信息保留度             ██████████ 100% │
│  配置时间               █            1x │
└────────────────────────────────────────────┘
```

## Caveman 的一部分

本技能是 [caveman](https://github.com/JuliusBrussee/caveman) 工具包的一部分——让 Claude 用更少 token 而不失准确度。

- **caveman** —— 让 Claude *说话*像 caveman（大幅削减回复 token，比例未实测，仅为估算）
- **caveman-compress** —— 让 Claude *读*得更少（削减约 46% 上下文 token）
