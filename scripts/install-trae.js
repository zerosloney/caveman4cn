#!/usr/bin/env node
// install-trae.js — Install caveman plugin for Trae IDE
//
// 用法：
//   npx @master0071/caveman-trae              # 安装
//   npx @master0071/caveman-trae --uninstall   # 卸载
//   npx @master0071/caveman-trae --dry-run     # 预览
//   node scripts/install-trae.js              # 本地安装
//
// Trae IDE 没有 marketplace/plugin.json 概念——它的 AI 资产是散落在
// ~/.trae-cn/（全局）和 .trae/（项目）目录下的文件。本安装器把 caveman
// 资产铺到全局约定位置：
//
//   ~/.trae-cn/skills/<name>/          # 7 个技能
//   ~/.trae-cn/commands/<name>.md      # 7 个命令
//   ~/.trae-cn/rules/caveman-activate.md  # 静态激活规则（Trae 原生 rules）
//   ~/.trae-cn/caveman-trae/           # 稳定目录：hooks/ tools/ agents/
//   ~/.trae-cn/hooks.json              # 合并 5 个事件的 hook 条目
//
// 关键：Trae 不在 command 字符串里插值 ${VAR}，所以写入 hooks.json 时把
// ${TRAE_PLUGIN_ROOT} 替换为 ~/.trae-cn/caveman-trae 的绝对路径（正斜杠）。
//
// 不依赖项目源目录；可从 npm 包运行。

'use strict';

const fs = require('fs');
const path = require('path');

const PLUGIN_NAME = 'caveman-trae';
const PLUGIN_VERSION = '0.1.0';
const MARKETPLACE = 'master0071'; // 仅为一致性标识；Trae 不读市场清单

// Trae 全局目录约定（文档：~/.trae-cn/）。
const TRAE_HOME = path.join(
  process.env.USERPROFILE || process.env.HOME || require('os').homedir(),
  '.trae-cn'
);

// hooks/tools/agents 的稳定落脚点。hooks.json 里的绝对路径指向这里。
const PLUGIN_STABLE_DIR = path.join(TRAE_HOME, PLUGIN_NAME);

const HOOKS_JSON = path.join(TRAE_HOME, 'hooks.json');

// 源文件：repo 里的 plugins/caveman-trae/ 目录
// npm install 后：scripts/ 和 plugins/ 同级
// npx 运行后：PATH 解析到 node_modules/@master0071/caveman-trae/scripts/
const SRC_DIR = path.join(__dirname, '..', 'plugins', 'caveman-trae');

const SKILLS = ['caveman', 'caveman-commit', 'caveman-compress', 'caveman-help',
                'caveman-review', 'caveman-stats', 'cavecrew'];
const COMMANDS = ['caveman', 'caveman-commit', 'caveman-compress', 'caveman-help',
                  'caveman-init', 'caveman-review', 'caveman-stats'];
const HOOK_FILES = ['hooks.json', 'caveman-config.js', 'caveman-stats.js',
                    'session-start.js', 'user-prompt.js', 'pre-tool-use.js',
                    'post-tool-use.js', 'stop.js'];
const TOOL_FILES = ['caveman-init.js'];
const AGENT_FILES = ['cavecrew-builder.md', 'cavecrew-general.md',
                     'cavecrew-investigator.md', 'cavecrew-reviewer.md'];

// 检查是否从 npm 包安装
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
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(p);
    } else {
      count++;
    }
  }
  return count;
}

// 把 Windows 反斜杠路径转为正斜杠，供 shell 命令跨平台使用。
function toPosix(p) {
  return p.replace(/\\/g, '/');
}

// 读取源 hooks.json 模板，把 ${TRAE_PLUGIN_ROOT} 替换为稳定目录的绝对
// POSIX 路径，剥离 _comment 字段，返回解析后的 hooks 对象。
function buildHooksObject() {
  const src = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'hooks', 'hooks.json'), 'utf-8'));
  const stablePosix = toPosix(PLUGIN_STABLE_DIR);
  const rewrite = (s) => s.replace(/\$\{TRAE_PLUGIN_ROOT\}/g, stablePosix);

  const out = { version: 1, hooks: {} };
  for (const [event, groups] of Object.entries(src.hooks || {})) {
    out.hooks[event] = groups.map((group) => ({
      ...(group.matcher ? { matcher: group.matcher } : {}),
      ...(group.loop_limit != null ? { loop_limit: group.loop_limit } : {}),
      hooks: (group.hooks || []).map((h) => ({
        type: h.type || 'command',
        command: rewrite(h.command || ''),
        ...(h.timeout != null ? { timeout: h.timeout } : {}),
      })),
    }));
  }
  return out;
}

// 标记一个 hook 条目是否属于 caveman-trae（按 command 含路径段判定）。
function isCavemanHook(hookDef) {
  return /caveman-trae[\\/]/.test(hookDef.command || '') ||
         /caveman-trae\/hooks\//.test(hookDef.command || '');
}

// 合并 caveman-trae 的 hook 条目到现有 ~/.trae-cn/hooks.json。
// 策略：对每个事件，先剔除现有 caveman-trae 条目（去重/重装），再追加新的。
function mergeHooks(existing, ours) {
  const result = { version: 1, hooks: {} };
  // 保留现有事件，但剔除其中 caveman-trae 的条目。
  for (const [event, groups] of Object.entries((existing && existing.hooks) || {})) {
    const kept = (groups || []).map((group) => {
      const filtered = (group.hooks || []).filter((h) => !isCavemanHook(h));
      if (filtered.length === 0) return null;
      return { ...group, hooks: filtered };
    }).filter(Boolean);
    if (kept.length) result.hooks[event] = kept;
  }
  // 追加我们的条目。
  for (const [event, groups] of Object.entries(ours.hooks || {})) {
    if (!result.hooks[event]) result.hooks[event] = [];
    result.hooks[event].push(...groups);
  }
  return result;
}

// 从 hooks 对象中移除所有 caveman-trae 条目（卸载用）。
function stripCavemanHooks(hooksObj) {
  const result = { version: 1, hooks: {} };
  for (const [event, groups] of Object.entries((hooksObj && hooksObj.hooks) || {})) {
    const kept = (groups || []).map((group) => {
      const filtered = (group.hooks || []).filter((h) => !isCavemanHook(h));
      if (filtered.length === 0) return null;
      return { ...group, hooks: filtered };
    }).filter(Boolean);
    if (kept.length) result.hooks[event] = kept;
  }
  return result;
}

// ── 安装 ────────────────────────────────────────────────────────────────

function install(dryRun) {
  console.log('🪨  Installing caveman for Trae IDE...\n');

  // 1. 检查源文件
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`错误: 找不到插件源文件 ${SRC_DIR}`);
    if (isNpmInstall()) {
      console.error('npm 包可能已损坏，尝试重新安装：');
      console.error('  npm install -g @master0071/caveman-trae');
    } else {
      console.error('请从仓库根目录运行此脚本');
    }
    process.exit(1);
  }

  // 2. 复制 skills 到 ~/.trae-cn/skills/
  console.log(`→ 复制技能到 ${toPosix(TRAE_HOME)}/skills/`);
  for (const skill of SKILLS) {
    const src = path.join(SRC_DIR, 'skills', skill);
    const dest = path.join(TRAE_HOME, 'skills', skill);
    if (!fs.existsSync(src)) {
      console.warn(`  跳过 ${skill}（源目录不存在）`);
      continue;
    }
    if (!dryRun) {
      if (fs.existsSync(dest)) deleteDirRecursive(dest);
      copyDirRecursive(src, dest);
      console.log(`  installed: skills/${skill}/ (${countFiles(dest)} files)`);
    } else {
      console.log(`  would copy: ${toPosix(src)} → ${toPosix(dest)}`);
    }
  }

  // 3. 复制 commands 到 ~/.trae-cn/commands/
  console.log(`\n→ 复制命令到 ${toPosix(TRAE_HOME)}/commands/`);
  for (const cmd of COMMANDS) {
    const src = path.join(SRC_DIR, 'commands', `${cmd}.md`);
    const dest = path.join(TRAE_HOME, 'commands', `${cmd}.md`);
    if (!fs.existsSync(src)) {
      console.warn(`  跳过 ${cmd}.md（源文件不存在）`);
      continue;
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      console.log(`  installed: commands/${cmd}.md`);
    } else {
      console.log(`  would copy: ${toPosix(src)} → ${toPosix(dest)}`);
    }
  }

  // 4. 复制静态规则到 ~/.trae-cn/rules/
  const rulesSrc = path.join(SRC_DIR, 'rules', 'caveman-activate.md');
  const rulesDest = path.join(TRAE_HOME, 'rules', 'caveman-activate.md');
  if (fs.existsSync(rulesSrc)) {
    console.log(`\n→ 复制静态规则到 ${toPosix(TRAE_HOME)}/rules/`);
    if (!dryRun) {
      fs.mkdirSync(path.dirname(rulesDest), { recursive: true });
      fs.copyFileSync(rulesSrc, rulesDest);
      console.log('  installed: rules/caveman-activate.md');
    } else {
      console.log(`  would copy: ${toPosix(rulesSrc)} → ${toPosix(rulesDest)}`);
    }
  }

  // 5. 复制 hooks + tools + agents 到 ~/.trae-cn/caveman-trae/
  console.log(`\n→ 复制 hooks/tools/agents 到 ${toPosix(PLUGIN_STABLE_DIR)}/`);
  for (const f of HOOK_FILES) {
    const src = path.join(SRC_DIR, 'hooks', f);
    const dest = path.join(PLUGIN_STABLE_DIR, 'hooks', f);
    if (!fs.existsSync(src)) continue;
    if (!dryRun) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }
  if (!dryRun) console.log(`  installed: hooks/ (${HOOK_FILES.length} files)`);
  else console.log(`  would copy: ${HOOK_FILES.length} hook files`);

  for (const f of TOOL_FILES) {
    const src = path.join(SRC_DIR, 'tools', f);
    const dest = path.join(PLUGIN_STABLE_DIR, 'tools', f);
    if (!fs.existsSync(src)) continue;
    if (!dryRun) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }
  if (!dryRun) console.log(`  installed: tools/ (${TOOL_FILES.length} files)`);
  else console.log(`  would copy: ${TOOL_FILES.length} tool files`);

  for (const f of AGENT_FILES) {
    const src = path.join(SRC_DIR, 'agents', f);
    const dest = path.join(PLUGIN_STABLE_DIR, 'agents', f);
    if (!fs.existsSync(src)) continue;
    if (!dryRun) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }
  if (!dryRun) console.log(`  installed: agents/ (${AGENT_FILES.length} files)`);
  else console.log(`  would copy: ${AGENT_FILES.length} agent files`);

  // 6. 合并 ~/.trae-cn/hooks.json
  console.log(`\n→ 合并 hook 配置到 ${toPosix(HOOKS_JSON)}`);
  if (!dryRun) {
    let existing = { version: 1, hooks: {} };
    if (fs.existsSync(HOOKS_JSON)) {
      try {
        existing = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf-8'));
      } catch {
        console.warn('  现有 hooks.json 解析失败，将覆盖');
      }
    }
    const ours = buildHooksObject();
    const merged = mergeHooks(existing, ours);
    fs.mkdirSync(path.dirname(HOOKS_JSON), { recursive: true });
    fs.writeFileSync(HOOKS_JSON, JSON.stringify(merged, null, 2) + '\n');
    const eventCount = Object.keys(merged.hooks || {}).length;
    console.log(`  merged: caveman-trae wired into ${eventCount} events`);
  } else {
    console.log('  would merge caveman-trae hooks into ~/.trae-cn/hooks.json');
  }

  console.log('\n✅ 安装完成。重启 Trae IDE 后生效。');
  console.log('   在会话中输入 /caveman 开启原始人模式');
  console.log('   可选：在项目根运行 node "' + toPosix(path.join(PLUGIN_STABLE_DIR, 'tools', 'caveman-init.js')) +
              '" 写入项目级 AGENTS.md 激活规则');
}

// ── 卸载 ────────────────────────────────────────────────────────────────

function uninstall(dryRun) {
  console.log('🪨  Uninstalling caveman from Trae IDE...\n');

  // 1. 删除 skills
  console.log(`→ 删除技能 (${toPosix(TRAE_HOME)}/skills/)`);
  for (const skill of SKILLS) {
    const dir = path.join(TRAE_HOME, 'skills', skill);
    if (fs.existsSync(dir)) {
      if (!dryRun) {
        deleteDirRecursive(dir);
        console.log(`  removed: skills/${skill}/`);
      } else {
        console.log(`  would remove: ${toPosix(dir)}`);
      }
    }
  }

  // 2. 删除 commands
  console.log(`\n→ 删除命令 (${toPosix(TRAE_HOME)}/commands/)`);
  for (const cmd of COMMANDS) {
    const file = path.join(TRAE_HOME, 'commands', `${cmd}.md`);
    if (fs.existsSync(file)) {
      if (!dryRun) {
        fs.unlinkSync(file);
        console.log(`  removed: commands/${cmd}.md`);
      } else {
        console.log(`  would remove: ${toPosix(file)}`);
      }
    }
  }

  // 3. 删除静态规则
  const ruleFile = path.join(TRAE_HOME, 'rules', 'caveman-activate.md');
  if (fs.existsSync(ruleFile)) {
    console.log(`\n→ 删除静态规则`);
    if (!dryRun) {
      fs.unlinkSync(ruleFile);
      console.log('  removed: rules/caveman-activate.md');
    } else {
      console.log(`  would remove: ${toPosix(ruleFile)}`);
    }
  }

  // 4. 删除稳定目录
  if (fs.existsSync(PLUGIN_STABLE_DIR)) {
    console.log(`\n→ 删除 ${toPosix(PLUGIN_STABLE_DIR)}/`);
    if (!dryRun) {
      deleteDirRecursive(PLUGIN_STABLE_DIR);
      console.log('  removed');
    } else {
      console.log('  would remove');
    }
  }

  // 5. 从 hooks.json 移除 caveman-trae 条目
  if (fs.existsSync(HOOKS_JSON)) {
    console.log(`\n→ 从 hooks.json 移除 caveman-trae 条目`);
    if (!dryRun) {
      try {
        const existing = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf-8'));
        const stripped = stripCavemanHooks(existing);
        fs.writeFileSync(HOOKS_JSON, JSON.stringify(stripped, null, 2) + '\n');
        const remaining = Object.keys(stripped.hooks || {}).length;
        console.log(`  cleaned: ${remaining} non-caveman events remain`);
      } catch (e) {
        console.warn(`  跳过 hooks.json 清理（解析失败: ${e.message}）`);
      }
    } else {
      console.log('  would strip caveman-trae entries from ~/.trae-cn/hooks.json');
    }
  }

  console.log('\n✅ 卸载完成。重启 Trae IDE 后生效。');
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
