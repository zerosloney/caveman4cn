---
description: Run the caveman installer for the detected host agent to merge hooks (and statusLine where supported) into its settings.json. 中文：为当前宿主运行 caveman 安装器，合并钩子（及状态行，若宿主支持）到其 settings.json。
argument-hint: "[--uninstall|--dry-run]"
---

# Caveman Install Helper

## Step 0 — Detect the host agent (do this first)

The caveman plugin ships a per-host installer per agent (`codebuddy`/`qwen`/`qoder`/`trae`/`zcode`), each writing to that host's own settings and data dirs. You must detect which host is running before running the installer.

Detection order (same as `scripts/statusline.js::detectAgentId`):

1. `CAVEMAN_AGENT` env var — explicit override. `echo $CAVEMAN_AGENT` (bash) or `$env:CAVEMAN_AGENT` (PowerShell).
2. Host env hints — `CODEBUDDY_TMUX_SESSION` or `CODEBUDDY_INSTANCE_META_PURPOSE` present ⇒ CodeBuddy.
3. Live `active` flag on disk — whichever of `codebuddy`/`qwen`/`qoder`/`trae`/`zcode` has a file at `~/.caveman/<agent>/active` wins. Check with: `ls ~/.caveman/*/active` and ignore the "no such file" noise from the shell.
4. Fallback — `qwen`.

Report the detected host to the user before proceeding.

## What to do

1. **Report the detected host**, then run the matching installer. The installer binaries are published via the package `bin` field:

   | Host | Installer command (npm) | Local command |
   |---|---|---|
   | **codebuddy** | `npx -p @master0071/caveman4cn caveman-codebuddy` | `node scripts/install-codebuddy.js` |
   | **qwen** | `npx -p @master0071/caveman4cn caveman-qwen` | `node scripts/install-qwen.js` |
   | **qoder** | `npx -p @master0071/caveman4cn caveman-qoder` | `node scripts/install-qoder.js` |
   | **trae** | `npx -p @master0071/caveman4cn caveman-trae` | `node scripts/install-trae.js` |
   | **zcode** | `npx -p @master0071/caveman4cn caveman-zcode` | `node scripts/install-zcode.js` |

2. **Flags** (all installers accept the same set):
   - `--uninstall` — remove caveman hooks and statusLine config from this host.
   - `--dry-run` — preview what would change without writing.

3. **Use this command** if hooks or statusLine are not active after a marketplace or git install. Each installer:
   - Copies plugin files into the host's data dir (e.g. `~/.qwen/extensions/caveman/`, `~/.codebuddy/plugins/caveman/`).
   - Merges hooks into the host's `settings.json`.
   - Where the host supports a status line (qwen `ui.statusLine`, codebuddy root `statusLine`), merges that too. qoder/trae/zcode have no status line config and skip this step.

4. **Before running**, show the user the exact command you will run and confirm. Always prefer `--dry-run` first if the user is unsure.

Do **not** write settings.json directly from this command — the installer script is the single writer. This command only detects the host and runs the right installer.
