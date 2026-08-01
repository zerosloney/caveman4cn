---
description: Help configure status line for the host agent. Check current config, show setup instructions, and optionally write settings.json. 中文：帮助配置状态行，检测当前宿主，显示状态、配置步骤、可选写入 settings.json
argument-hint: "[--setup|--status]"
---

# Caveman Status Line Helper

The user wants to configure the host agent's status line to show caveman mode info.

## Step 0 — Detect the host agent (do this first)

The caveman plugin ships per-agent hook dirs (`codebuddy`/`qwen`/`qoder`/`trae`/`zcode`), and the status line script (`scripts/statusline.js`) is shared and host-agnostic. But the **config mechanism** for the status line differs per host. You must detect which host is running before reading or writing its config.

Detection order (same as `scripts/statusline.js::detectAgentId`):

1. `CAVEMAN_AGENT` env var — explicit override. `echo $CAVEMAN_AGENT` (bash) or `$env:CAVEMAN_AGENT` (PowerShell).
2. Host env hints — `CODEBUDDY_TMUX_SESSION` or `CODEBUDDY_INSTANCE_META_PURPOSE` present ⇒ CodeBuddy.
3. Live `active` flag on disk — whichever of `codebuddy`/`qwen`/`qoder`/`trae`/`zcode` has a file at `~/.caveman/<agent>/active` wins. Check with: `ls ~/.caveman/*/active` and ignore the "no such file" noise from the shell.
4. Fallback — `qwen`.

Report the detected host to the user before proceeding.

## Status line support matrix

| Host | Supported | settings.json | statusLine key | script location |
|---|---|---|---|---|
| **codebuddy** | ✅ | `~/.codebuddy/settings.json` | root `statusLine` | `~/.codebuddy/plugins/caveman/scripts/statusline.js` |
| **qwen** | ✅ | `~/.qwen/settings.json` | `ui.statusLine` | `~/.qwen/extensions/caveman/scripts/statusline.js` |
| **qoder** | ❌ | — | — | — |
| **trae** | ❌ | — | — | — |
| **zcode** | ❌ | — | — | — |

If the host is `qoder`/`trae`/`zcode`: report that status line config is not supported on this host (no `statusLine` config key exists). Offer `caveman-stats` as the alternative for viewing savings. Do **not** attempt to write any settings file.

## How the status line works (qwen / codebuddy)

The host supports a `statusLine` config that points to an executable script. The host calls it on message/file changes (~300ms debounce), sends JSON via stdin, and renders the first stdout line (up to two lines) at the bottom of the interface. Set `refreshInterval` (seconds) for time-based updates.

### qwen — config shape (`ui.statusLine`)

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

Note: `statusLine` **must** sit under the `ui` key for qwen. A root-level `statusLine` does not take effect.

### codebuddy — config shape (root `statusLine`)

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.codebuddy/plugins/caveman/scripts/statusline.js",
    "refreshInterval": 5
  }
}
```

Note: codebuddy uses the **root-level** `statusLine` (no `ui` wrapper).

## What to do

1. **Check current status**: Read the host's `settings.json` (path from the matrix above) and inspect the relevant `statusLine` key. If the `command` field points at the caveman statusline script, report it as configured.

2. **Report findings** in Chinese, formatted like:

   ```
   🪨 Caveman 状态行助手

   当前宿主：<detected-host>
   当前状态：已配置 ✅ / 未配置 ❌

   状态行脚本：<script-location from matrix>

   示例输出：
   ```
   ⛏ [full] 📁 my-project  🌿 main  📊 12.3k→3.9k  💡 7.3k  💰 12.4k
   ```

3. **If not configured**, show the setup instructions for the detected host:

   ```
   配置步骤：

   编辑 <settings.json path>，在 <statusLine key location> 下添加：

     <config shape for this host — see above>

   注意：<host-specific note about key placement>
   设置热重载——保存后立即生效，无需重启。

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

4. **If the user passes `--setup`**: Offer to write the config automatically. Read the host's `settings.json`, merge the correct `statusLine` key (creating `ui` for qwen if absent; root for codebuddy), and write it back. Show a diff before writing. If the key already exists and points elsewhere, warn and do **not** overwrite unless `--force` is also passed.

5. **If the user passes `--status`**: Just show the current status without setup instructions.

Do **not** write any files without the user's explicit confirmation. Always show a diff/preview first.
