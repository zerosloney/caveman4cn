---
description: Help configure status line for Qwen Code. Check current config, show setup instructions, and optionally write settings.json. 中文：帮助配置 Qwen Code 状态行，显示当前状态、配置步骤、可选写入 settings.json
argument-hint: "[--setup|--status]"
---

# Caveman Status Line Helper

The user wants to configure the Qwen Code status line to show caveman mode info.

## How the status line works

Qwen Code supports a `statusLine` config under the `ui` key in `settings.json`:
- **User-level**: `~/.qwen/settings.json`
- **Project-level**: `.qwen/settings.json`

The config points to an executable script. Qwen Code calls it on message/file changes (~300ms debounce), sends JSON via stdin, and renders the first stdout line (up to two lines) at the bottom of the interface. Set `refreshInterval` (seconds) for time-based updates.

Config shape:
```json
{
  "ui": {
    "statusLine": {
      "type": "command",
      "command": "node ~/.qwen/extensions/caveman/scripts/statusline.js",
      "refreshInterval": 5
    }
  }
}
```

## What to do

1. **Check current status**: Look at `~/.qwen/settings.json` under the `ui.statusLine` key. If the `command` field points at the caveman statusline script, report it as configured.

2. **Report findings** in Chinese, formatted like:

   ```
   🪨 Caveman 状态行助手

   当前状态：已配置 ✅ / 未配置 ❌

   状态行脚本：~/.qwen/extensions/caveman/scripts/statusline.js

   示例输出：
   ```
   ⛏ [full] 📁 my-project  🌿 main  📊 12.3k→3.9k  💡 7.3k (65%)  💰 12.4k
   ```

3. **If not configured**, show the setup instructions:

	   ```
	   配置步骤：

	   编辑 ~/.qwen/settings.json，在 ui.statusLine 下添加：

	     {
	       "ui": {
	         "statusLine": {
	           "type": "command",
	           "command": "node ~/.qwen/extensions/caveman/scripts/statusline.js",
	           "refreshInterval": 5
	         }
	       }
	     }

	   注意：statusLine 必须放在 ui 键下，根级别的 statusLine 不生效。
	   设置热重载——保存后立即生效，无需重启 Qwen Code。

	   自定义显示：
	   编辑 ~/.caveman/config.json，添加 statusline 节：

	     {
	       "statusline": {
	         "showMode": true,
	         "showDir": true,
	         "showGit": true,
	         "showSavings": true,
	         "showModel": false,
	         "showSessionTokens": true,
	         "showSessionSaved": true,
	         "showCost": false,
	         "showContext": false
	       }
	     }

	   显示字段说明：
	     ⛏ mode     — 当前模式（off/lite/full/ultra）
	     📁 dir      — 当前工作目录名
	     🌿 branch   — git 分支名
	     📊 in→out   — 本会话输入/输出 token（实时，Stop hook 更新）
	     💡 saved    — 本会话节省 token 及百分比
	     💲 cost     — 本会话成本（需宿主 stdin 提供 cost 字段，默认关）
	     📉 context  — 剩余上下文百分比（需宿主提供，默认关）
	     💰 savings  — 累计节省 token（lifetime）
	     🤖 model    — 模型名（默认关）

	   支持的颜色键（color 值：green/blue/yellow/cyan/magenta/gray）：
	     modeColor, dirColor, gitColor, savingsColor, modelColor,
	     sessionTokensColor, sessionSavedColor, costColor, contextColor
	   ```

4. **If the user passes `--setup`**: Offer to write the config automatically. Read `~/.qwen/settings.json`, merge the `ui.statusLine` key (creating `ui` if absent), and write it back. Show a diff before writing. If `ui.statusLine` already exists and points elsewhere, warn and do NOT overwrite unless `--force` is also passed.

5. **If the user passes `--status`**: Just show the current status without setup instructions.

Do NOT write any files without the user's explicit confirmation. Always show a diff/preview first.
