#!/usr/bin/env node
// install-codebuddy.js — Install caveman plugin for CodeBuddy
//
// 用法：
//   npx @master0071/codebuddy-caveman              # 安装
//   npx @master0071/codebuddy-caveman --uninstall   # 卸载
//   npx @master0071/codebuddy-caveman --dry-run     # 预览
//   node scripts/install-codebuddy.js               # 本地安装
//
// 将插件复制到 ~/.codebuddy/plugins/codebuddy-caveman/
// 并通过 CodeBuddy 市场系统注册，不依赖项目源目录。

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PLUGIN_NAME = 'caveman-codebuddy';
const MARKETPLACE_NAME = 'master0071';
const PLUGIN_VERSION = '0.1.0';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CODEBUDDY_PLUGIN_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME,
  '.codebuddy', 'plugins'
);
const INSTALL_DIR = path.join(CODEBUDDY_PLUGIN_DIR, PLUGIN_NAME);

// 源文件：插件目录
const SRC_DIR = path.join(PROJECT_ROOT, 'plugins', 'codebuddy');

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

function findCodeBuddy() {
  try {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'where codebuddy' : 'which codebuddy';
    const out = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    return out.split('\n')[0].trim();
  } catch {
    return null;
  }
}

function runCB(args, dryRun) {
  const cmd = `codebuddy ${args}`;
  if (dryRun) {
    console.log(`  would run: ${cmd}`);
    return '';
  }
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });
  } catch (err) {
    throw new Error(err.stderr || err.message);
  }
}

// ── 安装 ────────────────────────────────────────────────────────────────

function ensureMarketplaceManifest() {
  const manifestFile = path.join(CODEBUDDY_PLUGIN_DIR, '.codebuddy-plugin', 'marketplace.json');
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });

  let data = { name: MARKETPLACE_NAME, description: '', owner: { name: 'master0071' }, plugins: [] };
  if (fs.existsSync(manifestFile)) {
    try { data = JSON.parse(fs.readFileSync(manifestFile, 'utf-8')); } catch (_) { /* 重置 */ }
  }

  // 始终更新市场名和描述
  data.name = MARKETPLACE_NAME;
  data.description = 'Custom marketplace for local CodeBuddy plugins';
  data.owner = data.owner || { name: 'master0071' };
  data.plugins = data.plugins || [];

  // 添加或更新插件条目
  const idx = data.plugins.findIndex(p => p.name === PLUGIN_NAME);
  const entry = {
    name: PLUGIN_NAME,
    description: 'Ultra-compressed communication mode for CodeBuddy. Cut filler. Keep technical accuracy.',
    version: PLUGIN_VERSION,
    source: `./${PLUGIN_NAME}`,
    category: 'productivity',
    author: { name: 'master0071', url: 'https://github.com/master0071' },
    homepage: 'https://github.com/zerosloney/caveman-codebuddy',
    license: 'MIT',
    tags: ['productivity', 'communication', 'brevity', 'codebuddy']
  };
  if (idx >= 0) {
    data.plugins[idx] = entry;
  } else {
    data.plugins.push(entry);
  }

  fs.writeFileSync(manifestFile, JSON.stringify(data, null, 2) + '\n');
}

function install(dryRun) {
  console.log('🪨  Installing caveman for CodeBuddy...\n');

  // 1. 检测 codebuddy CLI
  const cbPath = findCodeBuddy();
  if (!cbPath) {
    console.error('Error: CodeBuddy CLI not found in PATH');
    console.error('Make sure CodeBuddy is installed:');
    console.error('  npm install -g codebuddy');
    process.exit(1);
  }
  console.log(`→ Found CodeBuddy at: ${cbPath}`);

  // 2. 检查源文件
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`\nError: plugin source not found at ${SRC_DIR}`);
    if (isNpmInstall()) {
      console.error('npm package may be corrupted. Try reinstalling:');
      console.error('  npm install -g @master0071/codebuddy-caveman');
    } else {
      console.error('Run this script from the repository root');
    }
    process.exit(1);
  }

  // 3. 复制插件文件到 ~/.codebuddy/plugins/codebuddy-caveman/
  console.log(`\n→ Copying plugin to ${INSTALL_DIR}`);
  if (!dryRun) {
    if (fs.existsSync(INSTALL_DIR)) {
      deleteDirRecursive(INSTALL_DIR);
    }
    copyDirRecursive(SRC_DIR, INSTALL_DIR);
    console.log(`  copied: ${countFiles(INSTALL_DIR)} files`);
  } else {
    console.log(`  would copy: ${SRC_DIR} → ${INSTALL_DIR}`);
  }

  // 4. 创建/更新市场清单
  console.log('\n→ Updating marketplace manifest...');
  if (!dryRun) {
    ensureMarketplaceManifest();
    console.log('  done');
  } else {
    console.log('  would create/update marketplace manifest');
  }

  // 5. 添加本地市场
  console.log(`\n→ Adding marketplace: ${MARKETPLACE_NAME}`);
  if (!dryRun) {
    try {
      runCB(`plugin marketplace add "${CODEBUDDY_PLUGIN_DIR}" --name ${MARKETPLACE_NAME}`, false);
    } catch (_) { /* 可能已存在 */ }
    console.log('  marketplace ready');
  } else {
    console.log(`  would run: codebuddy plugin marketplace add "${CODEBUDDY_PLUGIN_DIR}" --name ${MARKETPLACE_NAME}`);
  }

  // 6. 更新市场
  console.log('\n→ Updating marketplace catalog...');
  if (!dryRun) {
    runCB(`plugin marketplace update ${MARKETPLACE_NAME}`, false);
    console.log('  marketplace updated');
  } else {
    console.log(`  would run: codebuddy plugin marketplace update ${MARKETPLACE_NAME}`);
  }

  // 7. 安装插件
  const pluginId = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
  console.log(`\n→ Installing plugin: ${pluginId}`);
  if (!dryRun) {
    try { runCB(`plugin uninstall ${pluginId}`, false); } catch (_) { /* 未安装，跳过 */ }
    runCB(`plugin install ${pluginId}`, false);
    console.log('  plugin installed');
  } else {
    console.log(`  would run: codebuddy plugin install ${pluginId}`);
  }

  console.log('\n✅  Installation complete!');
  console.log('   Run /reload-plugins in CodeBuddy, or start a new session.');
  console.log('   Type /caveman to enable caveman mode.');
}

// ── 卸载 ────────────────────────────────────────────────────────────────

function uninstall(dryRun) {
  console.log('🪨  Uninstalling caveman from CodeBuddy...\n');

  const pluginId = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

  // 1. 卸载插件
  console.log(`→ Uninstalling plugin: ${pluginId}`);
  if (!dryRun) {
    try {
      runCB(`plugin uninstall ${pluginId}`, false);
      console.log('  plugin uninstalled');
    } catch (_) {
      console.log('  plugin not found, skipping');
    }
  } else {
    console.log(`  would run: codebuddy plugin uninstall ${pluginId}`);
  }

  // 2. 删除安装目录
  if (fs.existsSync(INSTALL_DIR)) {
    console.log(`\n→ Removing plugin files: ${INSTALL_DIR}`);
    if (!dryRun) {
      deleteDirRecursive(INSTALL_DIR);
      console.log('  removed');
    } else {
      console.log('  would remove');
    }
  }

  // 3. 移除市场
  console.log(`\n→ Removing marketplace: ${MARKETPLACE_NAME}`);
  if (!dryRun) {
    try {
      runCB(`plugin marketplace remove ${MARKETPLACE_NAME}`, false);
      console.log('  marketplace removed');
    } catch (_) {
      console.log('  marketplace not found, skipping');
    }
  } else {
    console.log(`  would run: codebuddy plugin marketplace remove ${MARKETPLACE_NAME}`);
  }

  console.log('\n✅  Uninstallation complete.');
  console.log('   Run /reload-plugins in CodeBuddy, or start a new session.');
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