---
description: Help configure status line for CodeBuddy Code. Check current config, show setup instructions, and optionally write settings.json. 中文：帮助配置 CodeBuddy Code 状态行，显示当前状态、配置步骤、可选写入 settings.json
argument-hint: "[--setup|--status|--force]"
---

# Caveman Status Line Helper

The user wants to configure the CodeBuddy status line to show caveman mode info.

## How the status line works

CodeBuddy supports a `statusLine` config in `settings.json`:
- **User-level**: `~/.codebuddy/settings.json`
- **Project-level**: `.codebuddy/settings.json`

The config points to an executable script. CodeBuddy calls it every ~300ms, sends JSON via stdin, and displays the first stdout line at the bottom of the CodeBuddy Code interface.

## Find the real statusline.js path

The script lives in **different places depending on how the plugin was installed**. Do NOT assume a single path — detect it. Probe in this order and use the first hit:

1. **npm / installer copy**: `<HOME>/.codebuddy/plugins/caveman-codebuddy/scripts/statusline.js`
2. **marketplace cache**: glob `<HOME>/.codebuddy/plugins/cache/*/caveman-codebuddy/*/scripts/statusline.js`. If multiple match, pick the one whose version directory sorts highest (e.g. `0.2.0` over `0.1.0`).
3. **marketplace mirror** (fallback): `<HOME>/.codebuddy/plugins/marketplaces/*/plugins/caveman-codebuddy/scripts/statusline.js`

`<HOME>` = `$env:USERPROFILE` on Windows, `$HOME` elsewhere. Resolve it; never leave a literal `~` in the resulting command.

If none of these exist, the plugin is not installed — tell the user to install it first.

## Path format rules (critical on Windows)

The detected path goes into `settings.json` as a shell command that `node` will execute. Two rules:

- **Use native absolute paths with forward slashes** on Windows: `C:/Users/<name>/.codebuddy/...`. `node.exe` resolves these reliably.
- **Do NOT use `~`-style paths** — CodeBuddy does not expand `~`, and `node` does not either.
- **Do NOT use MSYS-style `/c/...` paths** — Git Bash silently rewrites them to `C:/...`, but CodeBuddy spawns the statusline command without a bash wrapper, so `node` sees `/c/...` literally and fails to find the file (it resolves `/c/` against the current drive, which doesn't exist). This is the most common cause of a blank status line.

## What to do

1. **Detect the script path** per the probe order above. If found, build the command string:
   `node "<detected-native-path>"`
   (quote the path so spaces in usernames survive).

2. **Check current status**: Read `~/.codebuddy/settings.json` (and `.codebuddy/settings.json` if it exists). A config counts as "configured" if `statusLine.command` points at any real caveman statusline.js — i.e. it matches the substring `caveman-codebuddy/scripts/statusline.js`. Also verify the configured command actually resolves to an existing file; if it doesn't, report it as **broken** (path stale or wrong format) rather than configured.

3. **Report findings** in Chinese, formatted like:

   ```
   🪨 Caveman 状态行助手

   当前状态：已配置 ✅ / 未配置 ❌ / 配置失效 ⚠️

   检测到的脚本：<detected path>
   当前 settings.json 中的命令：<existing command or 空>

   示例输出：
     ⛏ [full] 📁 my-project  🌿 main  💰 12.4k
   ```

   If the status is **broken**, explain why (path doesn't exist, or uses `~`/`/c/` form) and offer to fix it via `--setup`.

4. **If not configured (or broken)**, show the setup instructions:

   ```
   配置步骤：

   编辑 ~/.codebuddy/settings.json，添加（路径用上面检测到的真实路径）：

     {
       "statusLine": {
         "type": "command",
         "command": "node <detected-native-path>",
         "padding": 0
       }
     }

   注意：
   - 路径必须是原生绝对路径（Windows 上用 C:/... 正斜杠）
   - 不要用 ~ 或 /c/ 形式 —— CodeBuddy 不展开 ~，node 不认 /c/
   - marketplace 安装的插件路径含版本号目录，升级版本后路径会变，重新跑 /caveman-statusline --setup 即可

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

5. **If the user passes `--setup`**: Offer to write the config automatically. Read `~/.codebuddy/settings.json`, merge the `statusLine` key, and write it back. Show a diff before writing. Ownership rules:
   - No existing `statusLine` → write it.
   - Existing `statusLine.command` matches `caveman-codebuddy/scripts/statusline.js` → update silently (path may have moved between installs).
   - Existing `statusLine.command` points at something else → **warn and do NOT overwrite** unless `--force` is also passed.

6. **If the user passes `--status`**: Just show the current status without setup instructions.

Do NOT write any files without the user's explicit confirmation. Always show a diff/preview first.
