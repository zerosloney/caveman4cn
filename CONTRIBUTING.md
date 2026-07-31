# 贡献 caveman4cn

本仓库是一个**三宿主市场**（`master0071`）：一套技能，交付给三个宿主——ZCode、CodeBuddy 和 Trae IDE。所有技能位于 `skills/`（权威源），并镜像到三个插件发行版。

## 快速定位

| 改什么 | 文件 |
|--------|------|
| Caveman 行为 | `skills/caveman/SKILL.md` |
| Commit message 格式 | `skills/caveman-commit/SKILL.md` |
| 代码审查格式 | `skills/caveman-review/SKILL.md` |
| 压缩逻辑 | `skills/caveman-compress/SKILL.md` |
| 速查卡 | `skills/caveman-help/SKILL.md` |
| Token 统计 | `skills/caveman-stats/SKILL.md` |
| Cavecrew 决策指南 | `skills/cavecrew/SKILL.md` |
| ZCode 安装器 | `scripts/install-zcode.js` |
| CodeBuddy 安装器 | `scripts/install-codebuddy.js` |
| Trae 安装器 | `scripts/install-trae.js` |

## 构建

编辑 `skills/<name>/SKILL.md`（真理之源），然后镜像到插件发行版目录
`plugins/caveman/skills/<name>/SKILL.md`。两处应保持字节一致。

### 镜像规则

- 7 个技能在 `skills/` 与 `plugins/caveman/skills/` 两处镜像。改一次，复制到另一处。
- `caveman-help`、`caveman-compress`、`caveman-stats` 三者的 README/SKILL 历史上
  按宿主分化（文档 URL、会话记录路径）；合并后保留单一版本，新增宿主差异时用
  多候选探测而非分裂文件。

### Hooks

Hook 脚本是**宿主专属**的（不同的环境变量、事件 schema、command vs process 类型、阻塞字段）。
它们不共享——编辑对应 `plugins/caveman/hooks/<host>/` 下的副本：

- ZCode: `plugins/caveman/hooks/zcode/*.js`（用 `${ZCODE_PLUGIN_ROOT}`、`type: "process"`、`timeoutMs`、阻塞用 exit 2 + stderr）
- CodeBuddy: `plugins/caveman/hooks/codebuddy/*.js`（用 `${CODEBUDDY_PLUGIN_ROOT}`、`type: "command"`、`timeout` 以秒为单位、阻塞用 `{continue:false, reason}`）
- Trae: `plugins/caveman/hooks/trae/*.js`（**无 `${VAR}` 配置插值**——安装器把 `${TRAE_PLUGIN_ROOT}` 替换为 `~/.trae-cn/caveman` 绝对路径、`type: "command"`、`timeout` 以秒为单位、5 事件 SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop、阻塞用 `{decision:"block", reason}`、PreToolUse 用 `permissionDecision: allow|deny|ask`、工具名 normalize 兼容 `Terminal/RunCommand/Bash` 与 `File System/Write`）
- Qoder: `plugins/caveman/hooks/qoder/*.js`（用 `${QODER_PLUGIN_ROOT}`、`type: "command"`、`timeout` 以秒为单位、7 事件含 PreCompact/PostToolUseFailure）
- Qwen: `plugins/caveman/hooks/qwen/*.js`（无 hooks.json，由安装器合并进 `~/.qwen/settings.json`）

从一个宿主移植 hook 到另一个时，适配 schema 字段——不要逐字复制。

### Commands 和 agents

Commands（`plugins/caveman/commands/*.md`）和 agents（`plugins/caveman/agents/*.md`）
是单一共享目录，各宿主按各自清单发现。**注意**：Trae 通过 UI 建智能体，不读
`agents/` 目录——这些文件作参考/文档，用户可按文件内容在 Trae UI 手动建智能体。

## 代码风格

- Hooks 在文件系统错误时必须静默失败（pass through）——绝不困住用户。例外：`pre-tool-use.js` 在任何错误时**失败关闭**（deny），因为坏掉的安全防护比误拦截更糟。
- 符号链接安全的 flag 写入。
- 编辑 `skills/` 源，不编辑 `plugins/caveman/skills/` 副本。

## 验证改动

```bash
# 语法检查所有 hook 脚本
node -c plugins/caveman/hooks/codebuddy/*.js
node -c plugins/caveman/hooks/zcode/*.js
node -c plugins/caveman/hooks/trae/*.js
node -c plugins/caveman/hooks/qoder/*.js
node -c plugins/caveman/hooks/qwen/*.js

# 校验 JSON 配置（所有市场清单 + 插件清单 + hooks.json）
node -e "['.codebuddy-plugin/marketplace.json','.qoder-plugin/marketplace.json','.zcode-plugin/marketplace.json','plugins/caveman/.codebuddy-plugin/plugin.json','plugins/caveman/.zcode-plugin/plugin.json','plugins/caveman/.trae-plugin/plugin.json','plugins/caveman/.qoder-plugin/plugin.json','plugins/caveman/qwen-extension.json','plugins/caveman/hooks/codebuddy/hooks.json','plugins/caveman/hooks/zcode/hooks.json','plugins/caveman/hooks/trae/hooks.json','plugins/caveman/hooks/qoder/hooks.json'].forEach(f=>JSON.parse(require('fs').readFileSync(f,'utf8'))); console.log('all JSON valid')"

# 模拟一个 hook（CodeBuddy）
echo '{"hook_event_name":"UserPromptSubmit","prompt":"/caveman-stats"}' | node plugins/caveman/hooks/codebuddy/user-prompt.js

# 模拟一个 hook（Trae，需先 cd 到 trae hooks 目录以便 require('./caveman-stats.js')）
echo '{"hook_event_name":"UserPromptSubmit","prompt":"/caveman-stats"}' | (cd plugins/caveman/hooks/trae && node user-prompt.js)

# 预览 Trae 安装（不写盘）
node scripts/install-trae.js --dry-run
```
