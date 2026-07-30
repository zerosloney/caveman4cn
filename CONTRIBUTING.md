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

编辑 `skills/<name>/SKILL.md`，然后镜像到**三个**插件发行版：

1. `plugins/caveman-zcode/skills/<name>/SKILL.md` (ZCode)
2. `plugins/caveman-codebuddy/skills/<name>/SKILL.md` (CodeBuddy)
3. `plugins/caveman-trae/skills/<name>/SKILL.md` (Trae)

### 镜像规则

- **7 个技能中有 5 个在 `skills/`、`plugins/caveman-zcode/skills/`、`plugins/caveman-codebuddy/skills/`、`plugins/caveman-trae/skills/` 四处字节一致**：caveman、caveman-commit、caveman-compress、caveman-review、cavecrew。改一次，复制到三处。
- **`caveman-help`** 各宿主不同：正文里的文档 URL 指向各自仓库（`caveman-zcode` vs `caveman-codebuddy`），Trae 版另加一段 Trae 安装说明。镜像正文但保留各自正确的 URL/说明。
- **`caveman-stats`** 各宿主不同：正文指向各自的 hook 路径和会话记录位置（`~/.zcode/cli/agents/` vs `~/.codebuddy/projects/` vs `~/.trae-cn/` 多候选探测）。镜像结构但保留各自正确的路径。

### Hooks

Hook 脚本是**宿主专属**的（不同的环境变量、事件 schema、command vs process 类型、阻塞字段）。它们不共享——编辑对应 `plugins/<host>/hooks/` 下的副本：

- ZCode: `plugins/caveman-zcode/hooks/*.js`（用 `${ZCODE_PLUGIN_ROOT}`、`type: "process"`、`timeoutMs`、阻塞用 exit 2 + stderr）
- CodeBuddy: `plugins/caveman-codebuddy/hooks/*.js`（用 `${CODEBUDDY_PLUGIN_ROOT}`、`type: "command"`、`timeout` 以秒为单位、阻塞用 `{continue:false, reason}`）
- Trae: `plugins/caveman-trae/hooks/*.js`（**无 `${VAR}` 配置插值**——安装器把 `${TRAE_PLUGIN_ROOT}` 替换为 `~/.trae-cn/caveman-trae` 绝对路径、`type: "command"`、`timeout` 以秒为单位、5 事件 SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop、阻塞用 `{decision:"block", reason}`、PreToolUse 用 `permissionDecision: allow|deny|ask`、工具名 normalize 兼容 `Terminal/RunCommand/Bash` 与 `File System/Write`）

从一个宿主移植 hook 到另一个时，适配 schema 字段——不要逐字复制。

### Commands 和 agents

Commands（`plugins/<host>/commands/*.md`）和 agents（`plugins/<host>/agents/*.md`）是宿主专属的 frontmatter。内容上保持三个宿主同步，但尊重各自的 frontmatter 约定。**注意**：Trae 通过 UI 建智能体，不读 `agents/` 目录——这些文件作参考/文档，用户可按文件内容在 Trae UI 手动建智能体。

## 代码风格

- Hooks 在文件系统错误时必须静默失败（pass through）——绝不困住用户。例外：`pre-tool-use.js` 在任何错误时**失败关闭**（deny），因为坏掉的安全防护比误拦截更糟。
- 符号链接安全的 flag 写入。
- 编辑 `skills/` 源，不编辑 `plugins/*/skills/` 副本。

## 验证改动

```bash
# 语法检查所有 hook 脚本
node -c plugins/caveman-codebuddy/hooks/*.js
node -c plugins/caveman-zcode/hooks/*.js
node -c plugins/caveman-trae/hooks/*.js

# 校验 JSON 配置
node -e "['.codebuddy-plugin/marketplace.json','.qoder-plugin/marketplace.json','marketplace.json','plugins/caveman-codebuddy/.codebuddy-plugin/plugin.json','plugins/caveman-zcode/.zcode-plugin/plugin.json','plugins/caveman-trae/.trae-plugin/plugin.json','plugins/caveman-codebuddy/hooks/hooks.json','plugins/caveman-zcode/hooks/hooks.json','plugins/caveman-trae/hooks/hooks.json'].forEach(f=>JSON.parse(require('fs').readFileSync(f,'utf8'))); console.log('all JSON valid')"

# 模拟一个 hook（CodeBuddy）
echo '{"hook_event_name":"UserPromptSubmit","prompt":"/caveman-stats"}' | node plugins/caveman-codebuddy/hooks/caveman-mode-tracker.js

# 模拟一个 hook（Trae，需先 cd 到 trae hooks 目录以便 require('./caveman-stats.js')）
echo '{"hook_event_name":"UserPromptSubmit","prompt":"/caveman-stats"}' | (cd plugins/caveman-trae/hooks && node user-prompt.js)

# 预览 Trae 安装（不写盘）
node scripts/install-trae.js --dry-run
```
