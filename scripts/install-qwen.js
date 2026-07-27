#!/usr/bin/env node
// install-qwen.js — Install caveman plugin for Qwen Code
//
// 用法：
//   node scripts/install-qwen.js              # 安装
//   node scripts/install-qwen.js --uninstall   # 卸载
//   node scripts/install-qwen.js --dry-run     # 预览
//   npx @master0071/caveman4cn                 # postinstall 链中运行
//
// 将 plugins/caveman-qwen/ 安装到 Qwen Code 扩展系统：
//   ~/.qwen/extensions/caveman-qwen/  → 扩展文件（无版本号子目录）
//   ~/.qwen/settings.json             → 合并 hooks（5 事件）+ ui.statusLine
//
// Qwen Code 没有 `${PLUGIN_ROOT}` 风格的钩子级环境变量注入；本安装器把绝对
// POSIX 路径直接写进 settings.json 的 command 字段，钩子脚本本身也从
// __dirname 解析扩展根，二者互为兜底。

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_NAME = 'caveman-qwen';
const PLUGIN_VERSION = '0.1.0';

const QWEN_HOME = path.join(
  process.env.USERPROFILE || process.env.HOME || os.homedir(),
  '.qwen'
);
// Qwen Code 扩展目录约定：~/.qwen/extensions/<name>/（无版本号子目录）
const EXT_DIR = path.join(QWEN_HOME, 'extensions', PLUGIN_NAME);
const SETTINGS_FILE = path.join(QWEN_HOME, 'settings.json');

// 源文件：repo 里的 plugins/caveman-qwen/ 目录
const SRC_DIR = path.join(__dirname, '..', 'plugins', 'caveman-qwen');

const SUBDIRS = [
  'skills', 'commands', 'agents',
  'hooks', 'scripts', 'tools',
];

// 钩子定义。command 用绝对 POSIX 路径（Qwen 在 Windows 上用 cmd.exe，但
// `node "C:/abs/path.js"` 在 cmd 下同样可用，POSIX 斜杠避免反斜杠转义地狱）。
// timeout 单位为毫秒（Qwen command-hook 约定）。
//
// 工具名 matcher：Qwen Code 原生工具用 snake_case（run_shell_command / write_file
// / edit），同时接受 PascalCase 别名（Bash / Write / WriteFile）作兼容（见官方
// hooks.md "Matcher Patterns"）。这里两种都列，确保无论 Qwen 传哪种形式都触发。
const HOOK_EVENTS = [
  {
    event: 'SessionStart',
    matcher: 'startup|clear|compact',
    script: 'session-start.js',
    timeout: 10000,
    name: 'caveman-session-start',
    description: 'Activate caveman mode and inject compressed-communication rules',
  },
  {
    event: 'UserPromptSubmit',
    matcher: '',
    script: 'user-prompt.js',
    timeout: 10000,
    name: 'caveman-user-prompt',
    description: 'Track caveman mode, handle /caveman commands, per-turn reinforcement',
  },
  {
    event: 'PreToolUse',
    matcher: 'run_shell_command|write_file|edit|Bash|Write|WriteFile|Edit',
    script: 'pre-tool-use.js',
    timeout: 5000,
    name: 'caveman-pre-tool-use',
    description: 'Block dangerous operations (rm -rf, system file writes, etc.)',
  },
  {
    event: 'PostToolUse',
    matcher: 'run_shell_command|write_file|edit|Bash|Write|WriteFile|Edit',
    script: 'post-tool-use.js',
    timeout: 5000,
    name: 'caveman-post-tool-use',
    description: 'Track tool usage for stats',
  },
  {
    event: 'Stop',
    matcher: '',
    script: 'stop.js',
    timeout: 5000,
    name: 'caveman-stop',
    description: 'Check output quality when caveman mode is active',
  },
  {
    event: 'PostToolUseFailure',
    matcher: 'run_shell_command|write_file|edit|Bash|Write|WriteFile|Edit',
    script: 'post-tool-use-failure.js',
    timeout: 5000,
    name: 'caveman-post-tool-use-failure',
    description: 'Provide compressed recovery advice on tool failure',
  },
  {
    event: 'PreCompact',
    matcher: 'auto|manual',
    script: 'pre-compact.js',
    timeout: 5000,
    name: 'caveman-pre-compact',
    description: 'Inject caveman rules into compression guidance',
  },
];

// 检查是否从 npm 包安装
function isNpmInstall() {
  return __dirname.includes('node_modules');
}

// ── 工具 ────────────────────────────────────────────────────────────────

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      // 跳过 Python 字节码缓存（若存在）
      if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
      fs.copyFileSync(s, d);
    }
  }
}

function deleteDirRecursive(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      deleteDirRecursive(p);
    } else {
      fs.unlinkSync(p);
    }
  }
  fs.rmdirSync(dir);
}

function countFiles(dir) {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else n++;
    }
  };
  try { walk(dir); } catch {}
  return n;
}

// 把 Windows 反斜杠路径转为 POSIX（正斜杠），避免 JSON/command 转义问题。
function toPosix(p) {
  return p.replace(/\\/g, '/');
}

// 构造指向某钩子脚本的 command 字符串。
// 注意：Qwen Code 在 Windows 下解析带引号的绝对路径时有 bug——它把引号内的
// 路径和当前工作目录拼接（如 `D:\cwd\"C:/abs/path.js"`），导致文件找不到。
// POSIX 正斜杠路径无空格，裸写即可，Windows 下 node 同样能解析。
function hookCommand(scriptName) {
  const scriptPath = toPosix(path.join(EXT_DIR, 'hooks', scriptName));
  return `node ${scriptPath}`;
}

// 判断一个 hook entry 的 command 是否指向本扩展（用于去重）。
function isCavemanHook(hookEntry) {
  const cmd = (hookEntry && hookEntry.command) || '';
  return typeof cmd === 'string' && cmd.includes('/caveman-qwen/hooks/');
}

// ── settings.json 读写 ────────────────────────────────────────────────

function readSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    // 损坏的 settings.json：备份后重置，绝不静默吞掉用户配置。
    const backup = SETTINGS_FILE + '.bak.' + Date.now();
    try {
      fs.copyFileSync(SETTINGS_FILE, backup);
      console.warn(`⚠️  settings.json 解析失败，已备份到 ${backup}，将重写。`);
    } catch {}
    return {};
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
}

// 合并钩子：对每个事件，移除任何指向旧 caveman-qwen 的条目，再追加新的。
function mergeHooks(settings, dryRun) {
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};

  for (const { event, matcher, script, timeout, name, description } of HOOK_EVENTS) {
    const arr = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];

    // 去重：移除 command 指向本扩展同脚本的旧条目（支持重装/升级）。
    const kept = arr.filter((group) => {
      if (!group || !Array.isArray(group.hooks)) return true;
      group.hooks = group.hooks.filter((h) => {
        // 同名钩子或同 command 路径的都移除（避免重复）
        if (h && h.name === name) return false;
        if (isCavemanHook(h) && h.command && h.command.includes(`/${script}`)) return false;
        return true;
      });
      // 移除空的 hooks 组
      return group.hooks.length > 0;
    });

    const newEntry = {
      ...(matcher ? { matcher } : {}),
      hooks: [
        {
          type: 'command',
          command: hookCommand(script),
          timeout,
          name,
          description,
        },
      ],
    };

    kept.push(newEntry);
    settings.hooks[event] = kept;

    if (dryRun) {
      console.log(`    would merge hook: ${event} (${script})`);
    }
  }
}

// 从 settings 移除所有 caveman-qwen 钩子条目。
function stripHooks(settings) {
  if (!settings.hooks || typeof settings.hooks !== 'object') return;
  for (const event of Object.keys(settings.hooks)) {
    const arr = settings.hooks[event];
    if (!Array.isArray(arr)) continue;
    const kept = arr.filter((group) => {
      if (!group || !Array.isArray(group.hooks)) return true;
      group.hooks = group.hooks.filter((h) => !isCavemanHook(h) && !(h && h.name && h.name.startsWith('caveman-')));
      return group.hooks.length > 0;
    });
    if (kept.length > 0) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

// 合并 ui.statusLine：若用户已配置且非本扩展，告警不覆盖。
function mergeStatusLine(settings, dryRun) {
  if (!settings.ui || typeof settings.ui !== 'object') settings.ui = {};
  const existing = settings.ui.statusLine;
  const cmd = `node ${toPosix(path.join(EXT_DIR, 'scripts', 'statusline.js'))}`;
  const desired = {
    type: 'command',
    command: cmd,
    refreshInterval: 5,
  };

  if (existing && typeof existing === 'object' && existing.command) {
    if (isCavemanStatusLine(existing)) {
      settings.ui.statusLine = desired;
      if (dryRun) console.log('    would update ui.statusLine (already caveman)');
    } else {
      console.warn(`⚠️  ui.statusLine 已配置且指向其它脚本，未覆盖：`);
      console.warn(`    ${existing.command}`);
      console.warn(`    如需启用 caveman 状态行，请手动改命令为：`);
      console.warn(`    ${cmd}`);
    }
  } else {
    settings.ui.statusLine = desired;
    if (dryRun) console.log('    would set ui.statusLine');
  }
}

function isCavemanStatusLine(sl) {
  const cmd = (sl && sl.command) || '';
  return typeof cmd === 'string' && cmd.includes('/caveman-qwen/scripts/statusline.js');
}

function stripStatusLine(settings) {
  if (settings.ui && settings.ui.statusLine && isCavemanStatusLine(settings.ui.statusLine)) {
    delete settings.ui.statusLine;
    if (Object.keys(settings.ui).length === 0) delete settings.ui;
  }
}

// ── 安装 ────────────────────────────────────────────────────────────────

function install(dryRun) {
  console.log('🪨  Installing caveman for Qwen Code...\n');

  // 1. 检查源文件
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`错误: 找不到扩展源文件 ${SRC_DIR}`);
    if (isNpmInstall()) {
      console.error('npm 包可能已损坏，尝试重新安装：');
      console.error('  npm install -g @master0071/caveman4cn');
    } else {
      console.error('请从仓库根目录运行此脚本');
    }
    process.exit(1);
  }

  // 2. 复制扩展文件
  console.log(`→ 复制扩展文件到 ${EXT_DIR}`);
  for (const sub of SUBDIRS) {
    const src = path.join(SRC_DIR, sub);
    const dest = path.join(EXT_DIR, sub);
    if (!fs.existsSync(src)) {
      console.warn(`  跳过 ${sub}（源目录不存在）`);
      continue;
    }
    if (!dryRun) {
      copyDirRecursive(src, dest);
      const count = countFiles(dest);
      console.log(`  installed: ${sub}/ (${count} files)`);
    } else {
      console.log(`  would copy: ${src} → ${dest}`);
    }
  }

  // 复制 caveman-stats.js 到 tools/ 目录（工具注册引用 tools/caveman-stats.js，
  // 但源文件在 hooks/ 目录，需额外复制一份到 tools/ 让工具能找到）。
  const statsSrc = path.join(SRC_DIR, 'hooks', 'caveman-stats.js');
  const statsDest = path.join(EXT_DIR, 'tools', 'caveman-stats.js');
  if (fs.existsSync(statsSrc)) {
    if (!dryRun) {
      fs.mkdirSync(path.dirname(statsDest), { recursive: true });
      fs.copyFileSync(statsSrc, statsDest);
      console.log('  installed: tools/caveman-stats.js (from hooks/)');
    } else {
      console.log(`  would copy: ${statsSrc} → ${statsDest}`);
    }
  } else {
    console.warn('  跳过 tools/caveman-stats.js（源文件不存在）');
  }

  // 复制根级 manifest 文件 qwen-extension.json
  const manifestSrc = path.join(SRC_DIR, 'qwen-extension.json');
  const manifestDest = path.join(EXT_DIR, 'qwen-extension.json');
  if (fs.existsSync(manifestSrc)) {
    if (!dryRun) {
      fs.copyFileSync(manifestSrc, manifestDest);
      console.log('  installed: qwen-extension.json');
    } else {
      console.log(`  would copy: ${manifestSrc} → ${manifestDest}`);
    }
  } else {
    console.warn('  跳过 qwen-extension.json（文件不存在）');
  }

  // 3. 合并 hooks + ui.statusLine 进 settings.json
  console.log(`\n→ 合并钩子与状态行到 ${SETTINGS_FILE}`);
  if (!dryRun) {
    const settings = readSettings();
    mergeHooks(settings, false);
    mergeStatusLine(settings, false);
    writeSettings(settings);
    console.log('  merged: 7 hooks (SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/PostToolUseFailure/PreCompact/Stop)');
    console.log('  merged: ui.statusLine');
  } else {
    const settings = readSettings();
    mergeHooks(settings, true);
    mergeStatusLine(settings, true);
  }

  console.log('\n✅ 安装完成。重启 Qwen Code 后生效（或运行 /extensions 热重载）。');
  console.log('   在会话中输入 /caveman 开启原始人模式');
  console.log('   状态行将显示 ⛏ 模式指示（ui.statusLine 已自动配置）');
}

// ── 卸载 ────────────────────────────────────────────────────────────────

function uninstall(dryRun) {
  console.log('🪨  Uninstalling caveman from Qwen Code...\n');

  // 1. 删除扩展文件
  if (fs.existsSync(EXT_DIR)) {
    console.log(`→ 删除扩展文件: ${EXT_DIR}`);
    if (!dryRun) {
      deleteDirRecursive(EXT_DIR);
      console.log('  removed');
    }
  } else {
    console.log('→ 扩展文件不存在，跳过');
  }

  // 2. 从 settings.json 移除 caveman 钩子与状态行
  if (fs.existsSync(SETTINGS_FILE)) {
    console.log(`→ 清理 ${SETTINGS_FILE}`);
    if (!dryRun) {
      const settings = readSettings();
      stripHooks(settings);
      stripStatusLine(settings);
      writeSettings(settings);
      console.log('  removed caveman hooks + ui.statusLine');
    } else {
      console.log('  would remove caveman hooks + ui.statusLine');
    }
  }

  console.log('\n✅ 卸载完成。重启 Qwen Code 后生效。');
}

// ── 入口 ────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const doUninstall = args.includes('--uninstall');

  if (doUninstall) {
    uninstall(dryRun);
  } else {
    install(dryRun);
  }
}

main();
