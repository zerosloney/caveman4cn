#!/usr/bin/env node
// install-zcode.js — Install caveman plugin for ZCode
//
// 用法：
//   npx -p @master0071/caveman4cn caveman-zcode              # 安装
//   npx -p @master0071/caveman4cn caveman-zcode --uninstall   # 卸载
//   npx -p @master0071/caveman4cn caveman-zcode --dry-run     # 预览
//   node scripts/install-zcode.js              # 本地安装
//
// 将 plugins/caveman/ 安装到 ZCode 插件系统：
//   cache/  → 插件文件
//   marketplaces/ → 注册
//   data/   → 启用标记
//   node scripts/install-zcode.js              # 安装
//   node scripts/install-zcode.js --uninstall   # 卸载
//   node scripts/install-zcode.js --dry-run     # 预览
//
// 将 plugins/caveman/ 安装到 ZCode 插件系统：
//   cache/  → 插件文件
//   marketplaces/ → 注册
//   data/   → 启用标记

'use strict';

const fs = require('fs');
const path = require('path');

const PLUGIN_NAME = 'caveman';
const PLUGIN_VERSION = '0.1.0';
// 自定义市场名 —— 不污染官方 zcode-plugins-official 市场。
// 市场靠目录约定发现：marketplaces/<MARKETPLACE>/marketplace.json 存在即注册。
const MARKETPLACE = 'master0071';
const ZCODE_PLUGIN_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME,
  '.zcode', 'cli', 'plugins'
);

const PLUGIN_ROOT = path.join(
  ZCODE_PLUGIN_DIR, 'cache', MARKETPLACE, PLUGIN_NAME, PLUGIN_VERSION
);

const MARKETPLACE_FILE = path.join(
  ZCODE_PLUGIN_DIR, 'marketplaces', MARKETPLACE, 'marketplace.json'
);

const DATA_DIR = path.join(
  ZCODE_PLUGIN_DIR, 'data', `${PLUGIN_NAME}@${MARKETPLACE}`
);

// 源文件：repo 里的 plugins/caveman/ 目录
// npm install 后：scripts/ 和 plugins/ 同级
// npx 运行后：PATH 解析到 node_modules/@master0071/caveman-zcode/scripts/
const SRC_DIR = path.join(__dirname, '..', 'plugins', 'caveman');
const HOOKS_SRC_DIR = path.join(SRC_DIR, 'hooks', 'zcode');

const SUBDIRS = ['.zcode-plugin', 'skills', 'commands', 'agents', 'hooks', 'assets'];

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

// ── 安装 ────────────────────────────────────────────────────────────────

function install(dryRun) {
  console.log('🪨  Installing caveman for ZCode...\n');

  // 1. 检查源文件
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`错误: 找不到插件源文件 ${SRC_DIR}`);
    if (isNpmInstall()) {
      console.error('npm 包可能已损坏，尝试重新安装：');
      console.error('  npm install -g @master0071/caveman-zcode');
    } else {
      console.error('请从仓库根目录运行此脚本');
    }
    process.exit(1);
  }

  // 2. 复制插件文件
  console.log(`→ 复制插件文件到 ${PLUGIN_ROOT}`);
  for (const sub of SUBDIRS) {
      const src = sub === 'hooks' ? HOOKS_SRC_DIR : path.join(SRC_DIR, sub);
      const dest = sub === 'hooks'
        ? path.join(PLUGIN_ROOT, 'hooks', 'zcode')
        : path.join(PLUGIN_ROOT, sub);
    if (!fs.existsSync(src)) {
      console.warn(`  跳过 ${sub}（源目录不存在）`);
      continue;
    }
    if (!dryRun) {
      copyDirRecursive(src, dest);
      const count = fs.readdirSync(dest, { recursive: true }).filter(f => fs.statSync(path.join(dest, f)).isFile()).length;
      console.log(`  installed: ${sub}/ (${count} files)`);
    } else {
      console.log(`  would copy: ${src} → ${dest}`);
    }
  }

  // 3. 注册到市场
  console.log(`\n→ 注册到市场 ${MARKETPLACE}`);
  if (!dryRun) {
    let marketplace = {
      name: MARKETPLACE,
      description: 'Caveman plugin for ZCode — ultra-compressed communication mode',
      owner: { name: 'zerosloney', url: 'https://github.com/zerosloney/caveman4cn' },
      plugins: [],
      version: 1,
    };
    if (fs.existsSync(MARKETPLACE_FILE)) {
      marketplace = JSON.parse(fs.readFileSync(MARKETPLACE_FILE, 'utf-8'));
    }

    // 检查是否已注册
    const entry = {
      cachePath: PLUGIN_ROOT.replace(/\\/g, '\\\\'),
      description: 'Ultra-compressed communication mode for ZCode. Cut filler. Keep technical accuracy.',
      name: PLUGIN_NAME,
      source: 'filesystem',
      version: PLUGIN_VERSION,
      author: { name: 'zerosloney', url: 'https://github.com/zerosloney/caveman4cn' },
      category: 'productivity',
      displayName: 'Caveman',
      displayName_i18n: { 'zh-CN': '原始人模式' }
    };
    const existing = marketplace.plugins.findIndex(p => p.name === PLUGIN_NAME);
    if (existing >= 0) {
      marketplace.plugins[existing] = entry; // 更新（支持重装/升级）
      fs.writeFileSync(MARKETPLACE_FILE, JSON.stringify(marketplace, null, 2) + '\n');
      console.log('  updated existing marketplace entry');
    } else {
      marketplace.plugins.unshift(entry);
      fs.mkdirSync(path.dirname(MARKETPLACE_FILE), { recursive: true });
      fs.writeFileSync(MARKETPLACE_FILE, JSON.stringify(marketplace, null, 2) + '\n');
      console.log('  registered in marketplace');
    }
  } else {
    console.log('  would register in marketplace');
  }

  // 4. 启用插件
  console.log(`\n→ 启用插件 ${PLUGIN_NAME}`);
  if (!dryRun) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('  enabled');
  } else {
    console.log('  would create data dir');
  }

  console.log('\n✅ 安装完成。重启 ZCode 后生效。');
  console.log('   在会话中输入 /caveman 开启原始人模式');
}

// ── 卸载 ────────────────────────────────────────────────────────────────

function uninstall(dryRun) {
  console.log('🪨  Uninstalling caveman from ZCode...\n');

  // 1. 删除插件文件
  if (fs.existsSync(PLUGIN_ROOT)) {
    console.log(`→ 删除插件文件: ${PLUGIN_ROOT}`);
    if (!dryRun) {
      deleteDirRecursive(PLUGIN_ROOT);
      console.log('  removed');
    }
  } else {
    console.log('→ 插件文件不存在，跳过');
  }

  // 2. 从市场移除
  if (fs.existsSync(MARKETPLACE_FILE)) {
    console.log(`→ 从市场移除: ${MARKETPLACE_FILE}`);
    if (!dryRun) {
      const marketplace = JSON.parse(fs.readFileSync(MARKETPLACE_FILE, 'utf-8'));
      marketplace.plugins = marketplace.plugins.filter(p => p.name !== PLUGIN_NAME);
      fs.writeFileSync(MARKETPLACE_FILE, JSON.stringify(marketplace, null, 2) + '\n');
      console.log('  removed from marketplace');
    }
  }

  // 3. 删除启用标记
  if (fs.existsSync(DATA_DIR)) {
    console.log(`→ 删除启用标记: ${DATA_DIR}`);
    if (!dryRun) {
      deleteDirRecursive(DATA_DIR);
      console.log('  removed');
    }
  }

  console.log('\n✅ 卸载完成。重启 ZCode 后生效。');
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
