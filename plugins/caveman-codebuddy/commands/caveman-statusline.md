---
description: Help configure status line for CodeBuddy Code. Check current config, show setup instructions, and optionally write settings.json. 中文：帮助配置 CodeBuddy Code 状态行，显示当前状态、配置步骤、可选写入 settings.json
argument-hint: "[--setup|--status]"
---

# Caveman Status Line Helper

The user wants to configure the CodeBuddy status line to show caveman mode info.

## How the status line works

CodeBuddy supports a `statusLine` config in `settings.json`:
- **User-level**: `~/.codebuddy/settings.json`
- **Project-level**: `.codebuddy/settings.json`

The config points to an executable script. CodeBuddy calls it every ~300ms, sends JSON via stdin, and displays the first stdout line at the bottom of the CodeBuddy Code interface.

## What to do

1. **Check current status**: Look at `~/.codebuddy/settings.json` and `.codebuddy/settings.json` (if exists) for a `statusLine` key. If the script path matches the caveman statusline script, report it as configured.

2. **Report findings** in Chinese, formatted like:

   ```
   🪨 Caveman 状态行助手

   当前状态：已配置 ✅ / 未配置 ❌

   状态行脚本：~/.codebuddy/plugins/caveman-codebuddy/scripts/statusline.js

   示例输出：
     ⛏ [full] 📁 my-project  🌿 main  💰 12.4k
   ```

3. **If not configured**, show the setup instructions:

   ```
   配置步骤：

   编辑 ~/.codebuddy/settings.json，添加：

     {
       "statusLine": {
         "type": "command",
         "command": "node ~/.codebuddy/plugins/caveman-codebuddy/scripts/statusline.js",
         "padding": 0
       }
     }

   然后重启 CodeBuddy 或执行 /reload-plugins。

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

4. **If the user passes `--setup`**: Offer to write the config automatically. Read `~/.codebuddy/settings.json`, merge the `statusLine` key, and write it back. Show a diff before writing.

5. **If the user passes `--status`**: Just show the current status without setup instructions.

Do NOT write any files without the user's explicit confirmation. Always show a diff/preview first.