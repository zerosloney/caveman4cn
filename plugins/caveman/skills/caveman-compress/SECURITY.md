# 安全

## Snyk 高风险评级

`caveman-compress` 因静态分析启发式规则获得 Snyk 高风险评级。本文档说明该技能做与不做什么。

### 什么触发了评级

1. **子进程使用**：未设置 `ANTHROPIC_API_KEY` 时，技能通过 `subprocess.run()` 调用 `claude` CLI 作为兜底。子进程调用使用固定参数列表——无 shell 插值。用户文件内容通过 stdin 传递，不作为 shell 参数。

2. **文件读写**：技能读取用户明确指定的文件，压缩后写回同一路径。旁边保存一份 `.original.md` 备份。不读写用户指定路径之外的任何文件。

### 该技能不做的事

- 不把用户文件内容当代码执行
- 除调用 Anthropic API（通过 SDK 或 CLI）外不发任何网络请求
- 不访问用户提供的路径之外的文件
- 子进程调用中不使用 shell=True 或字符串插值
- 不收集或传输被压缩文件之外的任何数据

### 认证行为

设置了 `ANTHROPIC_API_KEY` 时，技能直接使用 Anthropic Python SDK（无子进程）。未设置时，回退到 `claude` CLI，使用用户既有的 Claude 桌面端认证。

### 文件大小限制

超过 500KB 的文件在任何 API 调用前被拒绝。

### 报告漏洞

如果你认为发现了真实的安全问题，请开一个带 `security` 标签的 GitHub issue。
