#!/usr/bin/env node
// install-reasonix.js — Install caveman plugin for Reasonix
//
// 用法：
//   node scripts/install-reasonix.js              # 安装
//   node scripts/install-reasonix.js --uninstall   # 卸载
//   node scripts/install-reasonix.js --dry-run     # 预览
//   npx -p @master0071/caveman4cn caveman-reasonix # npm 包入口
//
// 将 plugins/caveman/ 安装到 Reasonix：
//   ~/.reasonix/plugins/caveman/  → 插件文件（含 skills/ + hooks/reasonix/）
//   ~/.reasonix/settings.json     → 合并 hooks（6 事件，绝对路径）
//
// Reasonix hook schema (Claude-style, FLAT object — see DESKTOP_HOOKS.zh-CN.md):
//   { event, match, command, description, timeout(ms), cwd }
// 关键差异 vs Qoder：
//   - timeout 单位是毫秒（不是秒）
//   - match 是 anchored 正则（"Bash" 只匹配 "Bash"，不匹配 "run_bash"）
//   - 字段是 match（不是 matcher），无 type/hooks 嵌套
// 命令用绝对 POSIX 路径（避免 ${REASONIX_PLUGIN_ROOT} 是否注入的不确定性）。

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_NAME = 'caveman';
const PLUGIN_VERSION = '0.1.0';

const REASONIX_HOME = path.join(
  process.env.USERPROFILE || process.env.HOME || os.homedir(),
  '.reasonix'
);
const PLUGIN_DIR = path.join(REASONIX_HOME, 'plugins', PLUGIN_NAME);
const SETTINGS_FILE = path.join(REASONIX_HOME, 'settings.json');

// 源文件：repo 里的 plugins/caveman/ 目录
const SRC_DIR = path.join(__dirname, '..', 'plugins', 'caveman');
const HOOKS_SRC_DIR = path.join(SRC_DIR, 'hooks', 'reasonix');
const HOOKS_INSTALL_DIR = path.join(PLUGIN_DIR, 'hooks', 'reasonix');
const SKILLS_SRC_DIR = path.join(__dirname, '..', 'skills');
const SKILLS_INSTALL_DIR = path.join(PLUGIN_DIR, 'skills');

// 6 事件覆盖 caveman 全部逻辑。Reasonix 字段：command/match/description/timeout(ms)。
// match 为 anchored 正则：Bash|Write|Edit 是 PascalCase 原生名，其余是常见
// snake_case 别名——Reasonix 不公开工具名 schema，覆盖双形式保险。
// PreToolUse/PostToolUse 共用同一 match，因为它们处理同一组变更型工具。
const HOOK_EVENTS = [
  {
    event: 'SessionStart',
    match: '',
    script: 'session-start.js',
    timeout: 10000,
    description: 'Activate caveman mode and inject compressed-communication rules',
  },
  {
    event: 'UserPromptSubmit',
    match: '',
    script: 'user-prompt.js',
    timeout: 10000,
    description: 'Track caveman mode, handle /caveman commands, per-turn reinforcement',
  },
  {
    event: 'PreToolUse',
    match: 'Bash|Write|Edit|run_in_terminal|run_shell_command|execute_command|create_file|write_file|edit_file|multiedit',
    script: 'pre-tool-use.js',
    timeout: 5000,
    description: 'Block dangerous operations (rm -rf, system file writes, etc.)',
  },
  {
    event: 'PostToolUse',
    match: 'Bash|Write|Edit|run_in_terminal|run_shell_command|execute_command|create_file|write_file|edit_file|multiedit',
    script: 'post-tool-use.js',
    timeout: 5000,
    description: 'Warn when a tool returns a large response',
  },
  {
    event: 'PreCompact',
    match: '',
    script: 'pre-compact.js',
    timeout: 5000,
    description: 'Inject caveman rules into compression guidance',
  },
  {
    event: 'Stop',
    match: '',
    script: 'stop.js',
    timeout: 10000,
    description: 'Check caveman output quality and record session stats snapshot',
  },
];

function isNpmInstall() {
  return __dirname.includes('node_modules');
}

// ── 工具 ────────────────────────────────────────────────────────────────

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const name = entry.name;
    if (name === '__pycache__' || name.endsWith('.pyc')) continue;
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
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

// Reasonix Windows 解析带空格/引号绝对路径行为未文档化。POSIX 正斜杠路径
// 无空格时裸写最稳。
function hookCommand(scriptName) {
  const scriptPath = toPosix(path.join(HOOKS_INSTALL_DIR, scriptName));
  return `node ${scriptPath}`;
}

function isCavemanHook(hookEntry) {
  const cmd = (hookEntry && hookEntry.command) || '';
  return typeof cmd === 'string' && /\/caveman(?:-reasonix)?[\\/]+hooks[\\/]+reasonix\//.test(cmd);
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

// Reasonix 接受三种 settings.json 结构：
//   1. { "hooks": { <Event>: [{...}] } }   ← 标准
//   2. { <Event>: [{...}] }                 ← 直接事件键
//   3. [ {...}, {...} ]                      ← 数组
// 这里采用标准格式 1（最稳，与文档主示例一致），并保持扁平 hook 对象。
function mergeHooks(settings, dryRun) {
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};

  for (const { event, match, script, timeout, description } of HOOK_EVENTS) {
    const arr = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];

    // 去重：移除指向本插件同脚本的旧条目（支持重装/升级）。
    const kept = arr.filter((h) => {
      if (!h) return false;
      if (isCavemanHook(h) && h.command && h.command.includes(`/${script}`)) return false;
      return true;
    });

    const newEntry = {
      command: hookCommand(script),
      description,
      timeout,
    };
    if (match) newEntry.match = match;

    kept.push(newEntry);
    settings.hooks[event] = kept;

    if (dryRun) {
      console.log(`    would merge hook: ${event} (${script})`);
    }
  }
}

function stripHooks(settings) {
  if (!settings.hooks || typeof settings.hooks !== 'object') return;
  for (const event of Object.keys(settings.hooks)) {
    const arr = settings.hooks[event];
    if (!Array.isArray(arr)) continue;
    const kept = arr.filter((h) => h && !isCavemanHook(h));
    if (kept.length > 0) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

// ── 安装 ────────────────────────────────────────────────────────────────

function install(dryRun) {
  console.log('🪨  Installing caveman for Reasonix...\n');

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

  // 2. 复制 hooks/reasonix/ → ~/.reasonix/plugins/caveman/hooks/reasonix/
  console.log(`→ 复制 hooks 到 ${toPosix(HOOKS_INSTALL_DIR)}`);
  if (!fs.existsSync(HOOKS_SRC_DIR)) {
    console.error(`错误: 找不到 hooks 源目录 ${HOOKS_SRC_DIR}`);
    process.exit(1);
  }
  if (!dryRun) {
    copyDirRecursive(HOOKS_SRC_DIR, HOOKS_INSTALL_DIR);
    const count = countFiles(HOOKS_INSTALL_DIR);
    console.log(`  installed: hooks/reasonix/ (${count} files)`);
  }

  // 3. 复制 skills/ → ~/.reasonix/plugins/caveman/skills/
  if (fs.existsSync(SKILLS_SRC_DIR)) {
    console.log(`→ 复制 skills 到 ${toPosix(SKILLS_INSTALL_DIR)}`);
    if (!dryRun) {
      copyDirRecursive(SKILLS_SRC_DIR, SKILLS_INSTALL_DIR);
      const count = countFiles(SKILLS_INSTALL_DIR);
      console.log(`  installed: skills/ (${count} files)`);
    }
  }

  // 4. 合并 hooks 进 settings.json
  console.log(`\n→ 合并钩子到 ${toPosix(SETTINGS_FILE)}`);
  if (!dryRun) {
    const settings = readSettings();
    mergeHooks(settings, false);
    writeSettings(settings);
    console.log('  merged: 6 hooks (SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/PreCompact/Stop)');
  } else {
    const settings = readSettings();
    mergeHooks(settings, true);
  }

  console.log('\n✅ 安装完成。重启 Reasonix 后生效。');
  console.log('   在会话中输入 /caveman 开启原始人模式');
  console.log('   SessionStart 事件会自动激活 caveman 并注入压缩通信规则。');
}

// ── 卸载 ────────────────────────────────────────────────────────────────

function uninstall(dryRun) {
  console.log('🪨  Uninstalling caveman from Reasonix...\n');

  // 1. 删除插件文件
  if (fs.existsSync(PLUGIN_DIR)) {
    console.log(`→ 删除插件文件: ${toPosix(PLUGIN_DIR)}`);
    if (!dryRun) {
      deleteDirRecursive(PLUGIN_DIR);
      console.log('  removed');
    }
  } else {
    console.log('→ 插件文件不存在，跳过');
  }

  // 2. 从 settings.json 移除 caveman 钩子
  if (fs.existsSync(SETTINGS_FILE)) {
    console.log(`→ 清理 ${toPosix(SETTINGS_FILE)}`);
    if (!dryRun) {
      const settings = readSettings();
      stripHooks(settings);
      writeSettings(settings);
      console.log('  removed caveman hooks');
    } else {
      console.log('  would remove caveman hooks');
    }
  }

  console.log('\n✅ 卸载完成。重启 Reasonix 后生效。');
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
