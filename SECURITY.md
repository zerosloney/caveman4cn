# 安全策略

## 受支持版本

本仓库仅支持 `master0071` 市场插件（`caveman-zcode`、`caveman-codebuddy`）的最新稳定版，提供安全补丁。

## 报告漏洞

如果你发现安全缺陷——比如通过 hook 的任意 shell 执行、工作区目录逃逸、通过注入 prompt 劫持凭据、或 stats hook 里的恶意 JSON 解析——**不要开公开 issue**。通过 [GitHub 私密漏洞上报](https://github.com/zerosloney/caveman4cn/security/advisories/new)或邮件私密联系维护者。

## 隐私与遥测

**无遥测。零。** 没有分析、崩溃上报、账户系统或接收数据的后端。你的代码、prompt 或会话的任何信息都不会被传到任何地方。

### 安装后：零网络调用

插件一旦安装，不发任何网络连接。审计本仓库即可验证：

- **Skills**（`skills/*/SKILL.md`）是 markdown prompt——无可执行代码、无网络。
- **Hooks**（`plugins/caveman/hooks/codebuddy/*.js`、`plugins/caveman/hooks/zcode/*.js` 等 5 平台）是本地 Node 脚本。它们只读写本地文件（会话记录、`~/.caveman-active` flag、`~/.caveman/lifetime-saved.json`），不含 HTTP、fetch 或 socket 模块。
- **`/caveman-stats`** 解析 `~/.codebuddy/projects/`（或 `~/.zcode/cli/agents/`）下的本地 CodeBuddy/ZCode 会话 JSONL 文件以显示 token 计数。它用硬编码的压缩常数（2.86），不传输任何东西。
- **`/caveman-compress`** 只做本地文件 I/O——它重写一个明确命名的本地文件并创建 `.original.md` 备份。无 globbing、无 shell-out。
- **`/caveman-init`** 把激活规则写进目标仓库的 `AGENTS.md`。一次本地文件写入。无网络。
- **`pre-tool-use.js`**（CodeBuddy 安全 hook）针对硬编码的破坏性模式 denylist（rm -rf /、系统文件写入等）检查传入的工具调用并返回 allow/deny。它读 stdin、写 stdout，磁盘上不触碰任何东西。

### 安装时：恰好这些网络请求，别无其他

唯一发生在你运行安装器或添加市场时的网络活动：

- `node scripts/install-codebuddy.js` / `install-zcode.js` 把插件文件复制进宿主的插件目录，并运行 `codebuddy plugin install` / ZCode 等价命令，后者通过 GitHub 从本仓库拉取。
- `/plugin marketplace add zerosloney/caveman-codebuddy`（或 zcode 变体）从 GitHub 克隆仓库。

这些步骤中不上传任何数据。

### 留在你机器上的东西

所有数据都是本地的：skill 文件、`~/.caveman-active` 模式 flag、`~/.caveman-active.prev`（一次性命令用完恢复之前模式的临时状态）、`~/.caveman-mode-log.jsonl`（模式转换的本地审计日志，用于 caveman-stats 归因）、`~/.caveman/lifetime-saved.json` 统计徽章、`.original.md` 备份。要移除安装器写入的内容，运行 `node scripts/install-codebuddy.js --uninstall`（或 zcode 等价命令）。

### 企业 / 气隙使用

安装后，插件自包含，完全离线可用。无许可证服务器、无外部后端。气隙系统可内部克隆本仓库并对本地副本运行安装器。

## 关于扫描器警告

- **Snyk 对 `caveman-compress` 标 "High Risk"：** 本技能读取、重写并备份一个用户指定的文件。原地文件重写会触发通用风险评分。这是已知的、有意的能力——无隐藏网络访问、无 shell 执行、仅明确命名的文件。见 `plugins/caveman/skills/caveman-compress/SECURITY.md` 的逐技能说明。
- **Hook 脚本因子进程/文件 I/O 模式被标记：** hook 调用 `node` 解析 stdin JSON 并发出 stdout JSON。它们不 spawn 任意进程、不读文档化路径之外的文件、并在任何错误时 fail open（SessionStart/UserPromptSubmit）或 fail closed（PreToolUse 安全防护）。
