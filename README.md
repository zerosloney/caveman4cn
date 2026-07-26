# Caveman Marketplace (master0071) 🪨

**一个仓库，三个宿主插件。** 词多何用，少即是好。

让代理像原始人一样说话。同样的答案，**输出 token 减少 65%**。脑子照旧，嘴巴变小。

## 这是什么

本仓库是名为 **`master0071`** 的统一插件市场，同时为三个宿主提供 Caveman 插件：

- **ZCode** 加载本仓库 → 获得 `caveman-zcode`
- **CodeBuddy** 加载本仓库 → 获得 `caveman-codebuddy`
- **Trae IDE** 运行 `install-trae.js` → 获得 `caveman-trae`

三个宿主各按自己的约定发现资产，互不干扰：

| 宿主 | 发现机制 | 加载的插件 |
|------|---------|-----------|
| ZCode | 仓库根 `marketplace.json` + `plugins/caveman-zcode/.zcode-plugin/plugin.json` | `caveman-zcode` |
| CodeBuddy | `.codebuddy-plugin/marketplace.json` + `plugins/caveman-codebuddy/.codebuddy-plugin/plugin.json` | `caveman-codebuddy` |
| Trae IDE | 安装器铺资产到 `~/.trae-cn/`（无市场清单概念） | `caveman-trae` |

ZCode 与 CodeBuddy 靠各自清单目录约定区分；Trae 没有 marketplace/plugin.json 概念，由安装器把 skills/commands/hooks/rules 铺到 `~/.trae-cn/` 全局约定位置。

## 目录结构

```
caveman4cn/
├── marketplace.json                     # ZCode 根清单 → caveman-zcode
├── .codebuddy-plugin/marketplace.json   # CodeBuddy 清单 → caveman-codebuddy
├── plugins/
│   ├── caveman-zcode/                   # ZCode 插件（Node hooks）
│   │   └── .zcode-plugin/plugin.json
│   ├── caveman-codebuddy/               # CodeBuddy 插件（Node hooks）
│   │   └── .codebuddy-plugin/plugin.json
│   └── caveman-trae/                    # Trae 插件（文档清单 + 安装器铺放资产）
│       └── .trae-plugin/plugin.json     # 仅作文档；Trae 不扫描
├── skills/                              # 共享技能源（真理之源）
├── scripts/
│   ├── install-zcode.js                 # 安装到 ZCode
│   ├── install-codebuddy.js             # 安装到 CodeBuddy
│   └── install-trae.js                  # 安装到 Trae（铺到 ~/.trae-cn/）
└── package.json                         # @master0071/caveman4cn
```

## 效果对比

| 普通代理 | Caveman |
|---------|---------|
| 您的 React 组件重新渲染的原因可能是每个渲染周期都创建了一个新的对象引用。当您将内联对象作为 prop 传递时，建议使用 useMemo 来记忆化该对象。 | New object ref each render. Inline object prop = new ref = re-render. Wrap in `useMemo`. |
| 当然！我很乐意帮您解决这个问题。您遇到的问题很可能是由您的身份验证中间件未正确验证令牌过期引起的。 | Bug in auth middleware. Token expiry check use `<` not `<=`. Fix: |

同样的修复方案。三分之一的字数。没有任何技术信息丢失。

## 安装

### ZCode

```bash
node scripts/install-zcode.js             # 安装
node scripts/install-zcode.js --dry-run   # 预览
node scripts/install-zcode.js --uninstall # 卸载
```

安装后重启 ZCode。

### CodeBuddy

```bash
node scripts/install-codebuddy.js             # 安装
node scripts/install-codebuddy.js --dry-run   # 预览
node scripts/install-codebuddy.js --uninstall # 卸载
```

安装后执行 `/reload-plugins`。

### Trae IDE

```bash
node scripts/install-trae.js             # 安装
node scripts/install-trae.js --dry-run   # 预览
node scripts/install-trae.js --uninstall # 卸载
```

Trae 没有 marketplace 概念——安装器把资产直接铺到 `~/.trae-cn/`：
- skills → `~/.trae-cn/skills/<name>/`
- commands → `~/.trae-cn/commands/`
- rules → `~/.trae-cn/rules/caveman-activate.md`（静态激活兜底）
- hooks + helpers + tools + agents → `~/.trae-cn/caveman-trae/`
- `~/.trae-cn/hooks.json` 合并 5 个事件（SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop）

安装后重启 Trae IDE。

### 一键全部安装（通过 npm）

```bash
npx @master0071/caveman4cn
```

`postinstall` 会依次运行两个安装器。

## 使用

- `/caveman` — 开启原始人模式（默认 full）
- `/caveman lite` — 轻度压缩
- `/caveman ultra` — 极限压缩
- `/caveman wenyan` — 文言文模式
- `/caveman-commit` — 传统提交信息，≤50 字主题
- `/caveman-review` — 一行式 PR 评论
- `/caveman-compress <file>` — 压缩记忆文件，永久节省输入 token
- `/caveman-init` — 写入 per-repo AGENTS.md 规则，CodeBuddy 每次会话自动加载 caveman
- `/caveman-stats` — 查看 token 节省统计
- `/caveman-help` — 快速参考卡
- `stop caveman` / `normal mode` — 关闭原始人模式

## 压缩级别

| 级别 | 效果 |
|------|------|
| `lite` | 去除废话，保持完整句子 |
| `full`（默认） | 省略冠词，使用片段，短同义词 |
| `ultra` | 极限压缩，每句话只出现一次事实 |
| `wenyan` | 文言文输出，最大压缩比 |

## 技能

| 技能 | 功能 |
|------|------|
| caveman | 核心压缩模式 |
| caveman-commit | 传统提交信息 |
| caveman-review | 代码审查 |
| caveman-compress | 文件压缩 |
| caveman-help | 快速参考卡 |
| caveman-stats | Token 统计 |
| cavecrew | 子代理决策指南 |

## 工作原理

1. 安装器将 `plugins/caveman-zcode/` 或 `plugins/caveman-codebuddy/` 复制到对应宿主的插件目录；Trae 则由安装器把 `plugins/caveman-trae/` 的资产铺到 `~/.trae-cn/` 各约定位置
2. 技能文件（`skills/*/SKILL.md`）告诉宿主：丢弃废话，保留实质
3. ZCode/CodeBuddy 的插件系统注册钩子、命令和技能；Trae 的 skills/commands/rules 落到 `~/.trae-cn/` 全局目录自动加载，hooks 通过合并 `~/.trae-cn/hooks.json` 注册
4. ZCode/CodeBuddy 只读取与自己约定相符的清单，因此只会加载对应插件；Trae 不读市场清单，资产靠约定路径发现

## 许可证

MIT — 见 [LICENSE](LICENSE)。
