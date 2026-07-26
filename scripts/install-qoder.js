#!/usr/bin/env node
// install-qoder.js — Install caveman plugin for Qoder
//
// 用法：
//   node scripts/install-qoder.js              # 安装
//   node scripts/install-qoder.js --uninstall   # 卸载
//   node scripts/install-qoder.js --dry-run     # 预览
//   npx @master0071/caveman4cn                  # postinstall 链中运行
//
// 将 plugins/caveman-qoder/ 安装到 Qoder：
//   ~/.qoder/plugins/caveman-qoder/  → 插件文件（含 .qoder-plugin/plugin.json）
//   ~/.qoder/settings.json           → 合并 hooks（5 事件，绝对路径）
//
// 双保险策略：Qoder 的插件级 hooks/hooks.json 用 ${QODER_PLUGIN_ROOT} 变量，
// 但该变量只有经 qodercli 正式登记的插件才会被注入。本安装器除了放置插件
// 文件外，还把 hooks 用绝对路径合并进 ~/.qoder/settings.json，确保即使用户
// 没跑 qodercli plugins install，钩子也能正常触发。若用户后续跑了 qodercli
// 登记，插件级 hooks.json 会生效（变量被注入），settings.json 里的副本也
// 不冲突（Qoder 合并多源 hooks）。

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_NAME = 'caveman-qoder';
const PLUGIN_VERSION = '0.1.0';

const QODER_HOME = path.join(
  process.env.USERPROFILE || process.env.HOME || os.homedir(),
  '.qoder'
);
// Qoder 插件目录约定：~/.qoder/plugins/<name>/（与 ~/.qoder/{skills,commands}/ 同级）
const PLUGIN_DIR = path.join(QODER_HOME, 'plugins', PLUGIN_NAME);
const SETTINGS_FILE = path.join(QODER_HOME, 'settings.json');

// 源文件：repo 里的 plugins/caveman-qoder/ 目录
const SRC_DIR = path.join(__dirname, '..', 'plugins', 'caveman-qoder');

const SUBDIRS = [
  '.qoder-plugin', 'skills', 'commands', 'agents',
  'hooks', 'tools',
];

// 钩子定义。command 用绝对 POSIX 路径（避免 ${QODER_PLUGIN_ROOT} 未注入的问题）。
// timeout 单位为秒（Qoder 约定，与 CodeBuddy 一致；不同于 Qwen 的毫秒）。
//
// 双运行时策略：Qoder IDE 支持 5 事件（UserPromptSubmit/PreToolUse/PostToolUse/
// PostToolUseFailure/Stop），CLI 支持 22 事件（含 SessionStart/PreCompact 等）。
// IDE 和 CLI 共享同一份 settings.json。这里注册全部 7 个事件——IDE 静默忽略
// 它不支持的事件（SessionStart/PreCompact），CLI 则使用它们获得真正的会话启动
// 自动激活。matcher 用 PascalCase 工具名（Qoder 原生）。
const HOOK_EVENTS = [
  {
    event: 'SessionStart',
    matcher: 'startup|clear|compact',
    script: 'session-start.js',
    timeout: 10,
    name: 'caveman-session-start',
    description: 'Activate caveman mode and inject rules (CLI only; IDE ignores)',
  },
  {
    event: 'UserPromptSubmit',
    matcher: '',
    script: 'user-prompt.js',
    timeout: 10,
    name: 'caveman-user-prompt',
    description: 'Activate caveman mode (IDE fallback for missing SessionStart), track mode, /caveman commands',
  },
  {
    event: 'PreToolUse',
    matcher: 'Bash|Write|Edit',
    script: 'pre-tool-use.js',
    timeout: 10,
    name: 'caveman-pre-tool-use',
    description: 'Block dangerous operations (rm -rf, system file writes, etc.)',
  },
  {
    event: 'PostToolUse',
    matcher: 'Bash|Write|Edit',
    script: 'post-tool-use.js',
    timeout: 10,
    name: 'caveman-post-tool-use',
    description: 'Track tool usage for stats',
  },
  {
    event: 'PostToolUseFailure',
    matcher: 'Bash|Write|Edit',
    script: 'post-tool-use-failure.js',
    timeout: 10,
    name: 'caveman-post-tool-use-failure',
    description: 'Provide compressed recovery advice on tool failure',
  },
  {
    event: 'PreCompact',
    matcher: 'auto|manual',
    script: 'pre-compact.js',
    timeout: 5,
    name: 'caveman-pre-compact',
    description: 'Inject caveman rules into compression guidance (CLI only; IDE ignores)',
  },
  {
    event: 'Stop',
    matcher: '',
    script: 'stop.js',
    timeout: 10,
    name: 'caveman-stop',
    description: 'Check output quality when caveman mode is active',
  },
];

// 检查是否从 npm 包安装
function isNpmInstall() {
  return __dirname.includes('node_modules');
}

// 检测 qodercli 是否在 PATH（用于提示用户可选登记）
function hasQoderCli() {
  try {
    require('child_process').execSync(
      process.platform === 'win32' ? 'where qodercli' : 'which qodercli',
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return true;
  } catch {
    return false;
  }
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

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

function hookCommand(scriptName) {
  const scriptPath = toPosix(path.join(PLUGIN_DIR, 'hooks', scriptName));
  return `node "${scriptPath}"`;
}

function isCavemanHook(hookEntry) {
  const cmd = (hookEntry && hookEntry.command) || '';
  return typeof cmd === 'string' && cmd.includes('/caveman-qoder/hooks/');
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

// 合并钩子：对每个事件，移除任何指向旧 caveman-qoder 的条目，再追加新的。
function mergeHooks(settings, dryRun) {
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};

  for (const { event, matcher, script, timeout, name, description } of HOOK_EVENTS) {
    const arr = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];

    // 去重：移除 command 指向本插件同脚本的旧条目（支持重装/升级）。
    const kept = arr.filter((group) => {
      if (!group || !Array.isArray(group.hooks)) return true;
      group.hooks = group.hooks.filter((h) => {
        if (h && h.name === name) return false;
        if (isCavemanHook(h) && h.command && h.command.includes(`/${script}`)) return false;
        return true;
      });
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

// 从 settings 移除所有 caveman-qoder 钩子条目。
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

// ── 安装 ────────────────────────────────────────────────────────────────

function install(dryRun) {
  console.log('🪨  Installing caveman for Qoder...\n');

  // 1. 检查源文件
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`错误: 找不到插件源文件 ${SRC_DIR}`);
    if (isNpmInstall()) {
      console.error('npm 包可能已损坏，尝试重新安装：');
      console.error('  npm install -g @master0071/caveman4cn');
    } else {
      console.error('请从仓库根目录运行此脚本');
    }
    process.exit(1);
  }

  // 2. 复制插件文件
  console.log(`→ 复制插件文件到 ${PLUGIN_DIR}`);
  for (const sub of SUBDIRS) {
    const src = path.join(SRC_DIR, sub);
    const dest = path.join(PLUGIN_DIR, sub);
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

  // 3. 合并 hooks 进 settings.json（双保险，确保不依赖 qodercli 登记）
  console.log(`\n→ 合并钩子到 ${SETTINGS_FILE}`);
  if (!dryRun) {
    const settings = readSettings();
    mergeHooks(settings, false);
    writeSettings(settings);
    console.log('  merged: 7 hooks (SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/PostToolUseFailure/PreCompact/Stop)');
  } else {
    const settings = readSettings();
    mergeHooks(settings, true);
  }

  // 4. 提示可选的 qodercli 登记
  console.log('\nℹ️  可选：让 Qoder 正式识别本插件（启用插件级 hooks.json 的变量注入）：');
  console.log('    qodercli plugins marketplace add <repo-or-dir>');
  console.log('    qodercli plugins install caveman-qoder');
  if (hasQoderCli()) {
    console.log('    （检测到 qodercli 已在 PATH）');
  } else {
    console.log('    （未检测到 qodercli，settings.json 里的钩子已足够工作）');
  }

  console.log('\n✅ 安装完成。重启 Qoder 后生效。');
  console.log('   在会话中输入 /caveman 开启原始人模式');
  console.log('   注意：Qoder 无 SessionStart 事件，首次提交 prompt 时自动激活 caveman');
}

// ── 卸载 ────────────────────────────────────────────────────────────────

function uninstall(dryRun) {
  console.log('🪨  Uninstalling caveman from Qoder...\n');

  // 1. 删除插件文件
  if (fs.existsSync(PLUGIN_DIR)) {
    console.log(`→ 删除插件文件: ${PLUGIN_DIR}`);
    if (!dryRun) {
      deleteDirRecursive(PLUGIN_DIR);
      console.log('  removed');
    }
  } else {
    console.log('→ 插件文件不存在，跳过');
  }

  // 2. 从 settings.json 移除 caveman 钩子
  if (fs.existsSync(SETTINGS_FILE)) {
    console.log(`→ 清理 ${SETTINGS_FILE}`);
    if (!dryRun) {
      const settings = readSettings();
      stripHooks(settings);
      writeSettings(settings);
      console.log('  removed caveman hooks');
    } else {
      console.log('  would remove caveman hooks');
    }
  }

  console.log('\n✅ 卸载完成。重启 Qoder 后生效。');
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
