# Caveman Marketplace (master0071) 🪨

**一个仓库，五个宿主插件。** 词多何用，少即是好。

让代理像原始人一样说话。同样的答案，**输出 token 减少 65%**。脑子照旧，嘴巴变小。

## 这是什么

本仓库是名为 **`master0071`** 的统一插件市场，同时为五个宿主提供 Caveman 插件：

- **ZCode** 加载本仓库 → 获得 `caveman-zcode`
- **CodeBuddy** 加载本仓库 → 获得 `caveman-codebuddy`
- **Trae IDE** 运行 `install-trae.js` → 获得 `caveman-trae`
- **Qwen Code** 运行 `install-qwen.js` → 获得 `caveman-qwen`
- **Qoder** 运行 `install-qoder.js` → 获得 `caveman-qoder`

五个宿主各按自己的约定发现资产，互不干扰：

| 宿主 | 发现机制 | 加载的插件 |
|------|---------|-----------|
| ZCode | 仓库根 `marketplace.json` + `plugins/caveman-zcode/.zcode-plugin/plugin.json` | `caveman-zcode` |
| CodeBuddy | `.codebuddy-plugin/marketplace.json` + `plugins/caveman-codebuddy/.codebuddy-plugin/plugin.json` | `caveman-codebuddy` |
| Trae IDE | 安装器铺资产到 `~/.trae-cn/`（无市场清单概念） | `caveman-trae` |
| Qwen Code | 安装器铺扩展到 `~/.qwen/extensions/caveman-qwen/` + 合并 `~/.qwen/settings.json` | `caveman-qwen` |
| Qoder | `.qoder-plugin/marketplace.json` + `plugins/caveman-qoder/.qoder-plugin/plugin.json`；安装器铺插件到 `~/.qoder/plugins/caveman-qoder/` + 合并 `~/.qoder/settings.json` | `caveman-qoder` |

ZCode 与 CodeBuddy 靠各自清单目录约定区分；Trae 没有 marketplace/plugin.json 概念，由安装器把 skills/commands/hooks/rules 铺到 `~/.trae-cn/` 全局约定位置；Qwen Code 由安装器把扩展铺到 `~/.qwen/extensions/caveman-qwen/`，并把钩子与状态行合并进 `~/.qwen/settings.json`；Qoder 由安装器把插件铺到 `~/.qoder/plugins/caveman-qoder/`（含 `.qoder-plugin/plugin.json` 清单），并把钩子合并进 `~/.qoder/settings.json`（双保险：也支持 `qodercli plugins marketplace add` + `qodercli plugins install` 正式登记，市场清单为根 `.qoder-plugin/marketplace.json`）。

## 目录结构

```
caveman4cn/
├── marketplace.json                     # ZCode 根清单 → caveman-zcode
├── qwen-extension.json                  # Qwen Code 根级扩展清单（Qwen 约定：根目录）
├── .codebuddy-plugin/marketplace.json   # CodeBuddy 清单 → caveman-codebuddy
├── .qoder-plugin/marketplace.json       # Qoder 市场清单 → caveman-qoder
├── plugins/
│   ├── caveman-zcode/                   # ZCode 插件（Node hooks）
│   │   └── .zcode-plugin/plugin.json
│   ├── caveman-codebuddy/               # CodeBuddy 插件（Node hooks）
│   │   └── .codebuddy-plugin/plugin.json
│   ├── caveman-trae/                    # Trae 插件（文档清单 + 安装器铺放资产）
│   │   └── .trae-plugin/plugin.json     # 仅作文档；Trae 不扫描
│   ├── caveman-qwen/                    # Qwen Code 扩展（Node hooks + statusline）
│   │   └── qwen-extension.json          # 插件内部清单（安装器复制用）
│   └── caveman-qoder/                   # Qoder 插件（Node hooks，无 statusline）
│       └── .qoder-plugin/plugin.json    # Qoder 插件清单
├── skills/                              # 共享技能源（真理之源）
├── scripts/
│   ├── install-zcode.js                 # 安装到 ZCode
│   ├── install-codebuddy.js             # 安装到 CodeBuddy
│   ├── install-trae.js                  # 安装到 Trae（铺到 ~/.trae-cn/）
│   ├── install-qwen.js                  # 安装到 Qwen Code（铺到 ~/.qwen/extensions/）
│   └── install-qoder.js                 # 安装到 Qoder（铺到 ~/.qoder/plugins/）
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

### Qwen Code

```bash
node scripts/install-qwen.js             # 安装
node scripts/install-qwen.js --dry-run   # 预览
node scripts/install-qwen.js --uninstall # 卸载
```

Qwen Code 的扩展约定：安装器把扩展铺到 `~/.qwen/extensions/caveman-qwen/`，并把钩子与状态行合并进 `~/.qwen/settings.json`：
- 扩展文件 → `~/.qwen/extensions/caveman-qwen/{skills,commands,agents,hooks,scripts,tools}/`
- 清单 → `~/.qwen/extensions/caveman-qwen/qwen-extension.json`（根级扩展清单）
- `~/.qwen/settings.json` 合并 7 个事件钩子（SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/PostToolUseFailure/PreCompact/Stop）+ `ui.statusLine`（自动配置，已存在则不覆盖）

安装后重启 Qwen Code，或运行 `/extensions` 热重载。

> **注意**：通过 `/extensions install <url>` 或 marketplace UI 安装时，Qwen Code 只复制扩展文件，**不会运行安装脚本**，因此钩子与状态行不会自动注册。安装后必须额外运行 `node scripts/install-qwen.js` 把钩子合并进 `~/.qwen/settings.json`。

### Qoder

```bash
node scripts/install-qoder.js             # 安装
node scripts/install-qoder.js --dry-run   # 预览
node scripts/install-qoder.js --uninstall # 卸载
```

Qoder 的插件约定：安装器把插件铺到 `~/.qoder/plugins/caveman-qoder/`（含 `.qoder-plugin/plugin.json` 清单），并把钩子合并进 `~/.qoder/settings.json`（双保险）：
- 插件文件 → `~/.qoder/plugins/caveman-qoder/{skills,commands,agents,hooks,tools}/`
- 清单 → `~/.qoder/plugins/caveman-qoder/.qoder-plugin/plugin.json`
- 插件级 `hooks/hooks.json`（用 `${QODER_PLUGIN_ROOT}`，需 qodercli 登记才注入）
- `~/.qoder/settings.json` 合并 7 个事件钩子（SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/PostToolUseFailure/PreCompact/Stop）——绝对路径，无需 qodercli 登记也能工作

可选：让 Qoder 正式识别插件（启用 `${QODER_PLUGIN_ROOT}` 变量注入）：
```
qodercli plugins marketplace add <repo-or-dir>
qodercli plugins install caveman-qoder
```

注意：Qoder **IDE 支持 5 个事件**（无 SessionStart/PreCompact），**CLI 支持 22 个事件**（含 SessionStart/PreCompact）。IDE 和 CLI 共享同一份配置——安装器注册全部 7 个事件，IDE 静默忽略它不支持的两个（SessionStart/PreCompact），CLI 则使用它们获得真正的会话启动自动激活。IDE 用户 caveman 模式在**首次提交 prompt 时由 UserPromptSubmit 钩子自动激活**（SessionStart 的等价兜底）。Qoder 也**不支持 statusLine**，故无状态行功能。

安装后重启 Qoder。

### 一键全部安装（通过 npm）

```bash
npx @master0071/caveman4cn
```

`postinstall` 会依次运行五个安装器。

## 使用

- `/caveman` — 开启原始人模式（默认 full）
- `/caveman lite` — 轻度压缩
- `/caveman ultra` — 极限压缩
- `/caveman wenyan` — 文言文模式
- `/caveman-commit` — 传统提交信息，≤50 字主题
- `/caveman-review` — 一行式 PR 评论
- `/caveman-compress <file>` — 压缩记忆文件，永久节省输入 token
- `/caveman-init` — 写入 per-repo AGENTS.md 规则，每次会话自动加载 caveman
- `/caveman-stats` — 查看 token 节省统计
- `/caveman-statusline` — 查看/配置状态行（CodeBuddy / Qwen Code）
- `/caveman-help` — 快速参考卡
- `stop caveman` / `normal mode` — 关闭原始人模式

## 压缩级别

| 级别 | 效果 |
|------|------|
| `lite` | 去除废话，保持完整句子 |
| `full`（默认） | 省略冠词，使用片段，短同义词 |
| `ultra` | 极限压缩，每句话只出现一次事实 |
| `wenyan` | 文言文输出，最大压缩比 |

## 状态行配置（CodeBuddy Code / Qwen Code）

Caveman 插件支持在 CodeBuddy Code 与 Qwen Code 界面底部显示状态行，实时显示当前压缩模式和 token 节省统计。通过安装器（`npx @master0071/caveman-codebuddy` / `install-qwen.js`）安装时会自动写入状态行配置；**从 marketplace UI/CLI 直接安装 CodeBuddy 插件不会触发安装器**，需运行 `/caveman-statusline --setup` 补写。如状态行未生效或路径漂移（升级版本后），同样运行 `/caveman-statusline` 重新探测并写入正确路径。

### 效果预览

```
⛏ [full] 📁 my-project  🌿 main  💰 12.4k
```

从左到右：当前模式 → 项目目录 → Git 分支 → 累计节省 token。

### 配置步骤（CodeBuddy）

推荐运行 `/caveman-statusline`（或 `/caveman-statusline --setup` 自动写入），命令会自动探测脚本真实位置（npm 安装路径或 marketplace 缓存路径）并写入 `~/.codebuddy/settings.json`。

如需手动编辑，`statusLine` 在**根级**（不是 `ui` 下）：

```json
{
  "statusLine": {
    "type": "command",
    "command": "node <statusline.js 的原生绝对路径>",
    "padding": 0
  }
}
```

> **Windows 路径要求**：`command` 里的路径**必须**用原生绝对路径并正斜杠（如 `C:/Users/<name>/.codebuddy/...`）。不要用 `~`（CodeBuddy 不展开），也不要用 MSYS 的 `/c/...`（node.exe 不解析，状态行会空白）。marketplace 安装的插件路径含版本号目录，升级版本后路径会变，重跑 `/caveman-statusline --setup` 即可。

改完重启 CodeBuddy 或执行 `/reload-plugins`。

### 配置步骤（Qwen Code）

Qwen Code 用户运行 `install-qwen.js` 时已自动写入 `ui.statusLine`（写入的是原生绝对路径，非 `~` 形式），无需手动配置。若要手动调整：

1. 编辑 `~/.qwen/settings.json`，在 `ui` 键下添加 `statusLine`（注意：根级别的 `statusLine` 不生效，必须在 `ui` 下）。下面示例的 `command` 路径仅供说明结构，实际请用安装器写入的绝对路径或自行替换：

```json
{
  "ui": {
    "statusLine": {
      "type": "command",
      "command": "node <statusline.js 的原生绝对路径>",
      "refreshInterval": 5
    }
  }
}
```

2. 保存即热重载生效，无需重启

### 自定义

编辑 `~/.caveman/config.json`，添加 `statusline` 节：

```json
{
  "statusline": {
    "showMode": true,
    "showDir": true,
    "showGit": true,
    "showSavings": true,
    "showModel": false
  }
}
```

| 选项 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `showMode` | boolean | `true` | 显示模式指示器（⛏ [full]） |
| `showDir` | boolean | `true` | 显示项目目录名（📁 my-project） |
| `showGit` | boolean | `true` | 显示 Git 分支（🌿 main） |
| `showSavings` | boolean | `true` | 显示累计节省 token（💰 12.4k） |
| `showModel` | boolean | `false` | 显示当前模型名（🤖 GPT-5） |

### 帮助命令

执行 `/caveman-statusline` 查看当前配置状态和详细设置说明。

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

1. 安装器将 `plugins/caveman-zcode/` 或 `plugins/caveman-codebuddy/` 复制到对应宿主的插件目录；Trae 则由安装器把 `plugins/caveman-trae/` 的资产铺到 `~/.trae-cn/` 各约定位置；Qwen Code 则由安装器把 `plugins/caveman-qwen/` 铺到 `~/.qwen/extensions/caveman-qwen/`；Qoder 则由安装器把 `plugins/caveman-qoder/` 铺到 `~/.qoder/plugins/caveman-qoder/`
2. 技能文件（`skills/*/SKILL.md`）告诉宿主：丢弃废话，保留实质
3. ZCode/CodeBuddy 的插件系统注册钩子、命令和技能；Trae 的 skills/commands/rules 落到 `~/.trae-cn/` 全局目录自动加载，hooks 通过合并 `~/.trae-cn/hooks.json` 注册；Qwen Code 的 skills/commands/agents 落到扩展目录自动发现，hooks 与 statusLine 通过合并 `~/.qwen/settings.json` 注册；Qoder 的 skills/commands/agents 落到插件目录自动发现，hooks 通过合并 `~/.qoder/settings.json` 注册（也支持插件级 `hooks/hooks.json`，需 qodercli 登记）
4. ZCode/CodeBuddy 只读取与自己约定相符的清单，因此只会加载对应插件；Trae、Qwen Code 与 Qoder 不读市场清单，资产靠约定路径发现

## 许可证

MIT — 见 [LICENSE](LICENSE)。
