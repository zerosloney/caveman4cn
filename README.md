# Caveman Marketplace (master0071) 🪨

**一个仓库，一个 Caveman 插件，多平台 hooks 适配。** 词多何用，少即是好。

让代理像原始人一样说话。同样的答案，**输出 token 明显更少（具体比例因回复而异，未实测，仅为估算）**。脑子照旧，嘴巴变小。

## 这是什么

本仓库是名为 **`master0071`** 的统一插件市场，同时为七个宿主提供 Caveman 插件：

- **ZCode** 加载本仓库 → 获得 `caveman`
- **CodeBuddy** 加载本仓库 → 获得 `caveman`
- **Trae IDE** 运行 `install-trae.js` → 安装 `caveman`
- **Qwen Code** 运行 `install-qwen.js` → 安装 `caveman`
- **Qoder** 运行 `install-qoder.js` → 安装 `caveman`
- **Oh My Pi (omp)** 运行 `install-omp.js` → 安装 `caveman`
- **Cline** 运行 `install-cline.js` → 安装 `caveman`（Rules + Skills）

六个宿主各按自己的约定发现资产，互不干扰：

| 宿主 | 发现机制 | 加载的插件 |
|------|---------|-----------|
| ZCode | `.zcode-plugin/marketplace.json` + `plugins/caveman/.zcode-plugin/plugin.json` | `caveman` |
| CodeBuddy | `.codebuddy-plugin/marketplace.json` + `plugins/caveman/.codebuddy-plugin/plugin.json` | `caveman` |
| Trae IDE | 安装器铺资产到 `~/.trae-cn/`（无市场清单概念） | `caveman` |
| Qwen Code | 安装器铺扩展到 `~/.qwen/extensions/caveman/` + 合并 `~/.qwen/settings.json` | `caveman` |
| Qoder | `.qoder-plugin/marketplace.json` + `plugins/caveman/.qoder-plugin/plugin.json`；安装器铺插件到 `~/.qoder/plugins/caveman/` + 合并 `~/.qoder/settings.json` | `caveman` |
| Oh My Pi | 安装器铺扩展到 `~/.omp/agent/extensions/caveman/` + 技能到 `~/.omp/agent/skills/` | `caveman` |
| Cline | 安装器铺规则到 `~/Documents/Cline/Rules/` + 技能到 `~/.cline/skills/`（或项目级 `.clinerules/` + `.cline/skills/`） | `caveman` |

ZCode 与 CodeBuddy 靠各自清单目录约定区分；Trae 没有 marketplace/plugin.json 概念，由安装器把 skills/commands/hooks/rules 铺到 `~/.trae-cn/` 全局约定位置；Qwen Code 由安装器把扩展铺到 `~/.qwen/extensions/caveman/`，并把钩子与状态行合并进 `~/.qwen/settings.json`；Qoder 由安装器把插件铺到 `~/.qoder/plugins/caveman/`（含 `.qoder-plugin/plugin.json` 清单），并把钩子合并进 `~/.qoder/settings.json`；Oh My Pi 由安装器把扩展文件（`index.ts`/`config.ts`/`stats.ts`/`package.json`）铺到 `~/.omp/agent/extensions/caveman/`，技能铺到 `~/.omp/agent/skills/`，omp 自动发现扩展并加载技能。公共源码只保留一份，平台差异位于 `plugins/caveman/hooks/<platform>/`。

## 目录结构

```
caveman4cn/
├── .zcode-plugin/marketplace.json       # ZCode 市场清单 → caveman
├── .codebuddy-plugin/marketplace.json   # CodeBuddy 市场清单 → caveman
├── .qoder-plugin/marketplace.json       # Qoder 市场清单 → caveman
├── .omp-plugin/marketplace.json         # Oh My Pi 市场清单 → caveman（skills/commands/agents）
├── qwen-extension.json                  # Qwen Code 根级扩展清单（Qwen 约定：根目录）
├── cline/
│   └── rules/
│       └── caveman.md                   # Cline 规则源（alwaysApply: true）
├── plugins/
│   └── caveman/                         # 唯一公共插件源码
│       ├── package.json                  # omp extension 入口（omp.extensions → hooks/omp/index.ts）
│       ├── .zcode-plugin/plugin.json
│       ├── .codebuddy-plugin/plugin.json
│       ├── .qoder-plugin/plugin.json
│       ├── .omp-plugin/plugin.json
│       ├── qwen-extension.json
│       └── hooks/                       # 唯一平台差异
│           ├── zcode/
│           ├── codebuddy/
│           ├── trae/
│           ├── qwen/
│           ├── qoder/
│           └── omp/
├── skills/                              # 共享技能源（真理之源）
├── scripts/
│   ├── install-zcode.js                 # 安装到 ZCode
│   ├── install-codebuddy.js             # 安装到 CodeBuddy
│   ├── install-trae.js                  # 安装到 Trae（铺到 ~/.trae-cn/）
│   ├── install-qwen.js                  # 安装到 Qwen Code（铺到 ~/.qwen/extensions/）
│   ├── install-qoder.js                 # 安装到 Qoder（铺到 ~/.qoder/plugins/）
│   ├── install-omp.js                   # 安装到 Oh My Pi（铺到 ~/.omp/agent/extensions/）
│   └── install-cline.js                 # 安装到 Cline（铺到 ~/Documents/Cline/Rules/ + ~/.cline/skills/）
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
- hooks + helpers + tools + agents → `~/.trae-cn/caveman/`
- `~/.trae-cn/hooks.json` 合并 5 个事件（SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop）

安装后重启 Trae IDE。

### Qwen Code

```bash
node scripts/install-qwen.js             # 安装
node scripts/install-qwen.js --dry-run   # 预览
node scripts/install-qwen.js --uninstall # 卸载
```

Qwen Code 的扩展约定：安装器把扩展铺到 `~/.qwen/extensions/caveman/`，并把钩子与状态行合并进 `~/.qwen/settings.json`：
- 扩展文件 → `~/.qwen/extensions/caveman/{skills,commands,agents,hooks,scripts,tools}/`
- 清单 → `~/.qwen/extensions/caveman/qwen-extension.json`（根级扩展清单）
- `~/.qwen/settings.json` 合并 7 个事件钩子（SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/PostToolUseFailure/PreCompact/Stop）+ `ui.statusLine`（自动配置，已存在则不覆盖）

安装后重启 Qwen Code，或运行 `/extensions` 热重载。

> **注意**：通过 `/extensions install <url>` 或 marketplace UI 安装时，Qwen Code 只复制扩展文件，**不会运行安装脚本**，因此钩子与状态行不会自动注册。安装后必须额外运行 `node scripts/install-qwen.js` 把钩子合并进 `~/.qwen/settings.json`。

### Qoder

```bash
node scripts/install-qoder.js             # 安装
node scripts/install-qoder.js --dry-run   # 预览
node scripts/install-qoder.js --uninstall # 卸载
```

Qoder 的插件约定：安装器把插件铺到 `~/.qoder/plugins/caveman/`（含 `.qoder-plugin/plugin.json` 清单），并把钩子合并进 `~/.qoder/settings.json`（双保险）：
- 插件文件 → `~/.qoder/plugins/caveman/{skills,commands,agents,hooks,tools}/`
- 清单 → `~/.qoder/plugins/caveman/.qoder-plugin/plugin.json`
- 插件级 `hooks/hooks.json`（用 `${QODER_PLUGIN_ROOT}`，需 qodercli 登记才注入）
- `~/.qoder/settings.json` 合并 7 个事件钩子（SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/PostToolUseFailure/PreCompact/Stop）——绝对路径，无需 qodercli 登记也能工作

可选：让 Qoder 正式识别插件（启用 `${QODER_PLUGIN_ROOT}` 变量注入）：
```
qodercli plugins marketplace add <repo-or-dir>
qodercli plugins install caveman
```

注意：Qoder **IDE 支持 5 个事件**（无 SessionStart/PreCompact），**CLI 支持 22 个事件**（含 SessionStart/PreCompact）。IDE 和 CLI 共享同一份配置——安装器注册全部 7 个事件，IDE 静默忽略它不支持的两个（SessionStart/PreCompact），CLI 则使用它们获得真正的会话启动自动激活。IDE 用户 caveman 模式在**首次提交 prompt 时由 UserPromptSubmit 钩子自动激活**（SessionStart 的等价兜底）。Qoder 也**不支持 statusLine**，故无状态行功能。

安装后重启 Qoder。

### Oh My Pi (omp)

omp 支持两条安装路径，**推荐 marketplace**：

```bash
# 路径 A（推荐）：marketplace — 一键装全部（skills/commands/agents + extension hooks）
omp plugin marketplace add zerosloney/caveman4cn
omp plugin install caveman@master0071

# 路径 B：installer — 铺扩展源码到 ~/.omp/agent/extensions/caveman/（离线/旧版 omp 兜底）
node scripts/install-omp.js             # 安装
node scripts/install-omp.js --dry-run   # 预览
node scripts/install-omp.js --uninstall # 卸载
```

Oh My Pi 的扩展约定：

- **marketplace 安装**（路径 A）—— omp 识别 `.omp-plugin/marketplace.json`，安装时通过插件根 `package.json` 的 `omp.extensions` 字段 symlink 进 `~/.omp/plugins/node_modules/`，加载 `hooks/omp/index.ts` extension。skills/commands/agents 同步可用。**无需额外脚本**。
- **installer 铺源码**（路径 B）—— 把 TypeScript 源码直接铺到 `~/.omp/agent/extensions/caveman/{index.ts,config.ts,stats.ts,package.json}`，技能铺到 `~/.omp/agent/skills/`。用于无 marketplace 访问或需手动控制安装位置的旧版 omp。
- 数据目录 → `~/.caveman/omp/`（token 统计等运行时数据）

installer 尊重 `PI_CODING_AGENT_DIR` 环境变量——设置后铺到 `${PI_CODING_AGENT_DIR}/extensions/caveman/` 而非默认的 `~/.omp/agent/`。

Oh My Pi 没有 session 钩子机制——extension 通过 `index.ts` 在 agent 初始化时加载配置与技能，自动激活 caveman 模式。安装后重启 omp 或启动新会话即可生效。

> **注意**：marketplace 升级插件后跑 `omp plugin upgrade caveman@master0071` 拉取最新版；installer 升级重跑 `install-omp.js` 覆盖旧文件。两条路径勿同时启用同名 extension，否则 omp 去重（先解析者生效）可能造成行为不一致。

### Cline

```bash
# Phase 1: Rules + Skills（基础版，无 hooks）
node scripts/install-cline.js             # 全局安装
node scripts/install-cline.js --project   # 项目级安装
node scripts/install-cline.js --dry-run   # 预览
node scripts/install-cline.js --uninstall # 卸载

# Phase 2: SDK Plugin（完整版，含 hooks）
node scripts/install-cline.js --plugin             # 全局安装 plugin
node scripts/install-cline.js --plugin --project   # 项目级安装 plugin
node scripts/install-cline.js --uninstall --plugin # 卸载 plugin
```

Cline 支持两种安装模式：

**Phase 1（Rules + Skills）**：基础版，无 hooks。安装器把规则和技能铺到 Cline 的发现路径：

- **全局安装**（默认）：
  - 规则 → `~/Documents/Cline/Rules/caveman.md`（`alwaysApply: true`，始终生效）
  - 技能 → `~/.cline/skills/<name>/SKILL.md`（7 个技能，按需加载）
- **项目级安装**（`--project`）：
  - 规则 → `.clinerules/caveman.md`（覆盖全局同名规则）
  - 技能 → `.cline/skills/<name>/SKILL.md`

Cline 的 Skills 格式与本项目 `SKILL.md` 完全兼容——技能自动暴露为 slash commands（`/caveman`、`/caveman-commit`、`/caveman-review` 等）。

> **Phase 1 限制**：不包含 hooks。压缩输出通过 Rules 始终生效，技能通过 Skills 按需加载。模式切换（lite/full/ultra/wenyan）依赖模型理解，无持久化状态。Token 统计、危险操作拦截、输出质量检查需等 Phase 2。

**Phase 2（SDK Plugin）**：完整版，含 hooks。安装器把 TypeScript plugin 铺到 `~/.cline/plugins/caveman-cline/`，Cline 自动发现并加载：

- **全局安装**（`--plugin`）：
  - Plugin → `~/.cline/plugins/caveman-cline/`（含 `caveman-plugin.ts` + 捆绑 skills）
- **项目级安装**（`--plugin --project`）：
  - Plugin → `.cline/plugins/caveman-cline/`

Plugin 提供完整的生命周期 hooks：

| Hook | 功能 |
|------|------|
| `sessionStart` | 自动激活 caveman 模式，注入压缩规则 |
| `beforeAgentStart` | 解析 `/caveman` 命令和自然语言激活，模式追踪，每轮强化 |
| `toolCallBefore` | 拦截危险操作（`rm -rf /`、系统文件写入等） |
| `toolCallAfter` | 通过 SDK 事件追踪 token 使用 |
| `runEnd` | 检查输出质量，阻止冗长输出（最多 3 次） |
| `sessionShutdown` | 持久化 lifetime 统计，重置 session |

Plugin 状态存储在 `~/.caveman/cline/`：
- `active` — 当前模式 flag
- `mode-log.jsonl` — 模式切换历史
- `lifetime-saved.json` — lifetime token 节省
- `session-snapshot.json` — 当前 session 统计

安装后重启 Cline 或新开一个会话。

### 一键全部安装（通过 npm）

```bash
npx @master0071/caveman4cn
```

安装不会自动修改宿主配置。按需运行对应安装器，例如：

```bash
npm run install:qwen
```

也可直接运行 `npm run install:zcode`、`install:codebuddy`、`install:trae`、`install:qwen`、`install:qoder`、`install:omp` 或 `install:cline`。

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

Caveman 插件支持在 CodeBuddy Code 与 Qwen Code 界面底部显示状态行，实时显示当前压缩模式和 token 节省统计。通过安装器（`npx -p @master0071/caveman4cn caveman-codebuddy` / `install-qwen.js`）安装时会自动写入状态行配置；**从 marketplace UI/CLI 直接安装 CodeBuddy 插件不会触发安装器**，需运行 `/caveman-statusline --setup` 补写。如状态行未生效或路径漂移（升级版本后），同样运行 `/caveman-statusline` 重新探测并写入正确路径。

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

1. 安装器从唯一的 `plugins/caveman/` 源目录复制公共资产，并只组装当前宿主的 `hooks/<platform>/`；Trae、Qwen Code、Qoder、Oh My Pi 再按各自约定铺放或合并配置；Cline 从 `cline/rules/` 复制规则文件，从 `skills/` 复制技能目录
2. 技能文件（`skills/*/SKILL.md`）告诉宿主：丢弃废话，保留实质
3. ZCode/CodeBuddy 的插件系统注册钩子、命令和技能；Trae 的 skills/commands/rules 落到 `~/.trae-cn/` 全局目录自动加载，hooks 通过合并 `~/.trae-cn/hooks.json` 注册；Qwen Code 的 skills/commands/agents 落到扩展目录自动发现，hooks 与 statusLine 通过合并 `~/.qwen/settings.json` 注册；Qoder 的 skills/commands/agents 落到插件目录自动发现，hooks 通过合并 `~/.qoder/settings.json` 注册（也支持插件级 `hooks/hooks.json`，需 qodercli 登记）；Oh My Pi 的扩展文件（`index.ts`/`config.ts`/`stats.ts`）落到 `extensions/caveman/` 目录，skills 落到 `skills/` 目录，omp 在 agent 初始化时自动发现并加载；Cline 的规则落到 `~/Documents/Cline/Rules/`（全局）或 `.clinerules/`（项目级），skills 落到 `~/.cline/skills/`（全局）或 `.cline/skills/`（项目级），Cline 自动发现并加载
4. ZCode/CodeBuddy 只读取与自己约定相符的 manifest；Trae、Qwen Code 与 Qoder 不同程度依赖安装器和约定路径发现；Oh My Pi 无需 manifest——扩展目录存在即发现；Cline 通过 Rules 的 `alwaysApply: true` 始终加载压缩规则，Skills 按需通过 slash commands 触发

## 许可证

MIT — 见 [LICENSE](LICENSE)。
