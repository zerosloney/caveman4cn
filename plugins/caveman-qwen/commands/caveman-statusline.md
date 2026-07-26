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
      "command": "node ~/.qwen/extensions/caveman-qwen/scripts/statusline.js",
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

   状态行脚本：~/.qwen/extensions/caveman-qwen/scripts/statusline.js

   示例输出：
     ⛏ [full] 📁 my-project  🌿 main  💰 12.4k
   ```

3. **If not configured**, show the setup instructions:

   ```
   配置步骤：

   编辑 ~/.qwen/settings.json，在 ui.statusLine 下添加：

     {
       "ui": {
         "statusLine": {
           "type": "command",
           "command": "node ~/.qwen/extensions/caveman-qwen/scripts/statusline.js",
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
         "showModel": false
       }
     }

   支持的颜色和元素详见 scripts/statusline.js 注释。
   ```

4. **If the user passes `--setup`**: Offer to write the config automatically. Read `~/.qwen/settings.json`, merge the `ui.statusLine` key (creating `ui` if absent), and write it back. Show a diff before writing. If `ui.statusLine` already exists and points elsewhere, warn and do NOT overwrite unless `--force` is also passed.

5. **If the user passes `--status`**: Just show the current status without setup instructions.

Do NOT write any files without the user's explicit confirmation. Always show a diff/preview first.
