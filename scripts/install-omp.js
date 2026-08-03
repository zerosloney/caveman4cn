#!/usr/bin/env node
// install-omp.js — Install caveman extension for Oh My Pi
//
// 用法：
//   npx -p @master0071/caveman4cn caveman-omp                # 安装
//   npx -p @master0071/caveman4cn caveman-omp --uninstall     # 卸载
//   npx -p @master0071/caveman4cn caveman-omp --dry-run       # 预览
//   node scripts/install-omp.js                # 本地安装
//
// 将 caveman OMP 扩展安装到 ~/.omp/agent/extensions/caveman/，
// 并把 skills 复制到 ~/.omp/agent/skills/。

'use strict';

const fs = require('fs');
const path = require('path');

const PLUGIN_NAME = 'caveman';
const PLUGIN_VERSION = '0.1.0';

const HOME_DIR = process.env.USERPROFILE || process.env.HOME || require('os').homedir();
const PROJECT_ROOT = path.resolve(__dirname, '..');

// OMP agent directory (respects PI_CODING_AGENT_DIR)
const OMP_AGENT_DIR = process.env.PI_CODING_AGENT_DIR || path.join(HOME_DIR, '.omp', 'agent');

// Extension install target
const EXTENSIONS_DIR = path.join(OMP_AGENT_DIR, 'extensions');
const INSTALL_DIR = path.join(EXTENSIONS_DIR, PLUGIN_NAME);

// Skills install target
const SKILLS_DIR = path.join(OMP_AGENT_DIR, 'skills');

// Caveman data directory
const CAVEMAN_DATA_DIR = path.join(HOME_DIR, '.caveman', 'omp');

// Source directories
const SRC_DIR = path.join(PROJECT_ROOT, 'plugins', PLUGIN_NAME);
const HOOKS_SRC_DIR = path.join(SRC_DIR, 'hooks', 'omp');
const SKILLS_SRC_DIR = path.join(PROJECT_ROOT, 'skills');

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

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

// ── 安装 ────────────────────────────────────────────────────────────────

function install(dryRun) {
  // 1. Copy extension files to ~/.omp/agent/extensions/caveman/
  const extFiles = ['index.ts', 'config.ts', 'stats.ts', 'package.json'];
  console.log(`\n📦 Installing caveman OMP extension...`);

  if (!dryRun) {
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
  }
  console.log(`  Target: ${toPosix(INSTALL_DIR)}`);

  for (const file of extFiles) {
    const srcPath = path.join(HOOKS_SRC_DIR, file);
    const destPath = path.join(INSTALL_DIR, file);
    if (!fs.existsSync(srcPath)) {
      console.warn(`  ⚠️  Source not found: ${srcPath}`);
      continue;
    }
    const srcSize = fs.statSync(srcPath).size;
    if (!dryRun) {
      fs.copyFileSync(srcPath, destPath);
    }
    console.log(`  ${toPosix(destPath)} (${srcSize} bytes)`);
  }

  // 2. Copy skills to ~/.omp/agent/skills/
  if (fs.existsSync(SKILLS_SRC_DIR)) {
    console.log(`\n📚 Installing skills...`);
    if (!dryRun) {
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
    }
    let skillCount = 0;
    for (const entry of fs.readdirSync(SKILLS_SRC_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillName = entry.name;
      const srcSkillDir = path.join(SKILLS_SRC_DIR, skillName);
      const destSkillDir = path.join(SKILLS_DIR, skillName);

      const skillMd = path.join(srcSkillDir, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;

      if (!dryRun) {
        fs.mkdirSync(destSkillDir, { recursive: true });
        copyDirRecursive(srcSkillDir, destSkillDir);
      }
      const fileCount = countFiles(srcSkillDir);
      console.log(`  ${skillName}/ (${fileCount} files)`);
      skillCount++;
    }
    console.log(`  Total: ${skillCount} skills`);
  } else {
    console.warn(`  ⚠️  Skills source not found: ${SKILLS_SRC_DIR}`);
  }

  // 3. Create caveman data directory
  if (!dryRun) {
    fs.mkdirSync(CAVEMAN_DATA_DIR, { recursive: true });
  }

  // 4. Summary
  const extCount = extFiles.filter(f => fs.existsSync(path.join(HOOKS_SRC_DIR, f))).length;
  console.log(`\n✅ Installation complete!`);
  console.log(`  Extension:  ${extCount} files → ${toPosix(INSTALL_DIR)}`);
  console.log(`  Skills:     → ${toPosix(SKILLS_DIR)}`);
  console.log(`  Data:       → ${toPosix(CAVEMAN_DATA_DIR)}`);
  console.log(``);
  console.log(`  Next steps:`);
  console.log(`  1. Restart omp (or start a new session)`);
  console.log(`  2. Type /caveman to activate caveman mode`);
  console.log(`  3. Or type "talk like caveman" to auto-activate`);
  console.log(``);
  console.log(`  OMP will auto-discover the extension from:`);
  console.log(`  ${toPosix(EXTENSIONS_DIR)}`);
  console.log(`  Skills will be loaded from:`);
  console.log(`  ${toPosix(SKILLS_DIR)}`);
  console.log(``);
  console.log(`  💡 Marketplace install now works directly!`);
  console.log(`     The plugin source now includes package.json with omp.extensions,`);
  console.log(`     so future marketplace installs will load extension hooks automatically.`);
  console.log(`     Run /marketplace update master0071 to refresh the cached plugin.`);
}

// ── 卸载 ────────────────────────────────────────────────────────────────

function uninstall(dryRun) {
  console.log(`\n🗑️  Uninstalling caveman OMP extension...`);

  // 1. Remove extension directory
  if (fs.existsSync(INSTALL_DIR)) {
    const fileCount = countFiles(INSTALL_DIR);
    if (!dryRun) {
      deleteDirRecursive(INSTALL_DIR);
    }
    console.log(`  Removed: ${toPosix(INSTALL_DIR)} (${fileCount} files)`);
  } else {
    console.log(`  Not found: ${toPosix(INSTALL_DIR)}`);
  }

  // 2. Remove installed skills
  if (fs.existsSync(SKILLS_SRC_DIR)) {
    for (const entry of fs.readdirSync(SKILLS_SRC_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillName = entry.name;
      const destSkillDir = path.join(SKILLS_DIR, skillName);
      if (fs.existsSync(destSkillDir)) {
        const fileCount = countFiles(destSkillDir);
        if (!dryRun) {
          deleteDirRecursive(destSkillDir);
        }
        console.log(`  Removed skill: ${skillName}/ (${fileCount} files)`);
      }
    }
  }

  // 3. Remove empty skills dir
  if (fs.existsSync(SKILLS_DIR)) {
    try {
      const remaining = fs.readdirSync(SKILLS_DIR);
      if (remaining.length === 0) {
        if (!dryRun) fs.rmdirSync(SKILLS_DIR);
        console.log(`  Removed empty: ${toPosix(SKILLS_DIR)}`);
      }
    } catch { /* skip */ }
  }

  // 4. Remove empty extensions dir
  if (fs.existsSync(EXTENSIONS_DIR)) {
    try {
      const remaining = fs.readdirSync(EXTENSIONS_DIR);
      if (remaining.length === 0) {
        if (!dryRun) fs.rmdirSync(EXTENSIONS_DIR);
        console.log(`  Removed empty: ${toPosix(EXTENSIONS_DIR)}`);
      }
    } catch { /* skip */ }
  }

  console.log(`\n✅ Uninstall complete. Restart omp for changes to take effect.`);
}

// ── 入口 ────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const isUninstall = args.includes('--uninstall');

  if (isUninstall) {
    uninstall(dryRun);
  } else {
    install(dryRun);
  }
}

main();