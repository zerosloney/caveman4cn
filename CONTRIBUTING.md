# 贡献 caveman4cn

本仓库是一个**双宿主市场**（`master0071`）：一套技能，交付给两个宿主——ZCode 和 CodeBuddy。所有技能位于 `skills/`（权威源），并镜像到两个插件发行版。

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

## 构建

编辑 `skills/<name>/SKILL.md`，然后镜像到**两个**插件发行版：

1. `plugins/caveman-zcode/skills/<name>/SKILL.md` (ZCode)
2. `plugins/caveman-codebuddy/skills/<name>/SKILL.md` (CodeBuddy)

### 镜像规则

- **7 个技能中有 5 个在 `skills/`、`plugins/caveman-zcode/skills/`、`plugins/caveman-codebuddy/skills/` 三处字节一致**：caveman、caveman-commit、caveman-compress、caveman-review、cavecrew。改一次，复制到两处。
- **`caveman-help`** 各宿主不同：正文里的文档 URL 指向各自仓库（`caveman-zcode` vs `caveman-codebuddy`）。镜像正文但保留各自正确的 URL。
- **`caveman-stats`** 各宿主不同：正文指向各自的 hook 路径和会话记录位置（`~/.zcode/cli/agents/` vs `~/.codebuddy/projects/`）。镜像结构但保留各自正确的路径。

### Hooks

Hook 脚本是**宿主专属**的（不同的环境变量、事件 schema、command vs process 类型）。它们不共享——编辑对应 `plugins/<host>/hooks/` 下的副本：

- ZCode: `plugins/caveman-zcode/hooks/*.js`（用 `${ZCODE_PLUGIN_ROOT}`、`type: "process"`、`timeoutMs`）
- CodeBuddy: `plugins/caveman-codebuddy/hooks/*.js`（用 `${CODEBUDDY_PLUGIN_ROOT}`、`type: "command"`、`timeout` 以秒为单位）

从一个宿主移植 hook 到另一个时，适配 schema 字段——不要逐字复制。

### Commands 和 agents

Commands（`plugins/<host>/commands/*.md`）和 agents（`plugins/<host>/agents/*.md`）是宿主专属的 frontmatter。内容上保持两个宿主同步，但尊重各自的 frontmatter 约定。

## 代码风格

- Hooks 在文件系统错误时必须静默失败（pass through）——绝不困住用户。例外：`pre-tool-use.js` 在任何错误时**失败关闭**（deny），因为坏掉的安全防护比误拦截更糟。
- 符号链接安全的 flag 写入。
- 编辑 `skills/` 源，不编辑 `plugins/*/skills/` 副本。

## 验证改动

```bash
# 语法检查所有 hook 脚本
node -c plugins/caveman-codebuddy/hooks/*.js
node -c plugins/caveman-zcode/hooks/*.js

# 校验 JSON 配置
node -e "['.codebuddy-plugin/marketplace.json','marketplace.json','plugins/caveman-codebuddy/.codebuddy-plugin/plugin.json','plugins/caveman-zcode/.zcode-plugin/plugin.json','plugins/caveman-codebuddy/hooks/hooks.json','plugins/caveman-zcode/hooks/hooks.json'].forEach(f=>JSON.parse(require('fs').readFileSync(f,'utf8'))); console.log('all JSON valid')"

# 模拟一个 hook
echo '{"hook_event_name":"UserPromptSubmit","prompt":"/caveman-stats"}' | node plugins/caveman-codebuddy/hooks/caveman-mode-tracker.js
```
