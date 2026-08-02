#!/usr/bin/env node
// install-cline.js — Install caveman for Cline (Phase 1: Rules + Skills)
//
// Usage:
//   npx -p @master0071/caveman4cn caveman-cline              # global install (Phase 1: Rules + Skills)
//   npx -p @master0071/caveman4cn caveman-cline --plugin      # global install (Phase 2: SDK Plugin)
//   npx -p @master0071/caveman4cn caveman-cline --project     # project install
//   npx -p @master0071/caveman4cn caveman-cline --uninstall   # uninstall
//   npx -p @master0071/caveman4cn caveman-cline --dry-run     # preview
//   node scripts/install-cline.js              # local install
//
// Cline extension model (Phase 1):
//   Global (default):
//     ~/Documents/Cline/Rules/caveman.md       # always-on rule
//     ~/.cline/skills/<name>/SKILL.md          # 7 on-demand skills
//   Project (--project):
//     .clinerules/caveman.md                   # project rule (overrides global)
//     .cline/skills/<name>/SKILL.md            # project skills
//
// Phase 1 does NOT include hooks (needs @cline/sdk Plugin, see Phase 2).

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME_DIR = process.env.USERPROFILE || process.env.HOME || os.homedir();
const PROJECT_ROOT = path.resolve(__dirname, '..');
const GLOBAL_SKILLS_DIR = path.join(HOME_DIR, '.cline', 'skills');
const RULES_SRC_DIR = path.join(PROJECT_ROOT, 'cline', 'rules');
const SKILLS_SRC_DIR = path.join(PROJECT_ROOT, 'skills');

const SKILLS = ['caveman', 'caveman-commit', 'caveman-compress', 'caveman-help',
                'caveman-review', 'caveman-stats', 'cavecrew'];

function getGlobalRulesDir() {
  const docsRules = path.join(HOME_DIR, 'Documents', 'Cline', 'Rules');
  if (fs.existsSync(docsRules)) return docsRules;
  return path.join(HOME_DIR, 'Cline', 'Rules');
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const name = entry.name;
    if (name === '__pycache__' || name.endsWith('.pyc')) continue;
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function deleteDirRecursive(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) deleteDirRecursive(p);
    else fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
}

function countFiles(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countFiles(p);
    else count++;
  }
  return count;
}


// ── Plugin Install ──────────────────────────────────────────────────────

const PLUGIN_SRC_DIR = path.join(PROJECT_ROOT, 'plugins', 'caveman', 'hooks', 'cline');
const GLOBAL_PLUGINS_DIR = path.join(HOME_DIR, '.cline', 'plugins', 'caveman-cline');
const PLUGIN_FILES = ['caveman-plugin.ts', 'caveman-config.ts', 'caveman-stats.ts', 'package.json', 'README.md'];

function installPlugin(dryRun, projectMode) {
  let pluginDest;
  if (projectMode) {
    pluginDest = path.join(process.cwd(), '.cline', 'plugins', 'caveman-cline');
  } else {
    pluginDest = GLOBAL_PLUGINS_DIR;
  }

  if (!fs.existsSync(PLUGIN_SRC_DIR)) {
    console.error('Error: plugin source not found: ' + PLUGIN_SRC_DIR);
    process.exit(1);
  }

  console.log('-> Install plugin to ' + toPosix(pluginDest));
  if (!dryRun) fs.mkdirSync(pluginDest, { recursive: true });
  let fileCount = 0;
  for (const file of PLUGIN_FILES) {
    const src = path.join(PLUGIN_SRC_DIR, file);
    const dest = path.join(pluginDest, file);
    if (!fs.existsSync(src)) {
      console.warn('  Warning: source not found: ' + src);
      continue;
    }
    if (!dryRun) fs.copyFileSync(src, dest);
    console.log('  ' + file);
    fileCount++;
  }

  const skillsDest = path.join(pluginDest, 'skills');
  console.log('\n-> Bundle skills to ' + toPosix(skillsDest));
  let skillCount = 0;
  for (const skill of SKILLS) {
    const srcSkillDir = path.join(SKILLS_SRC_DIR, skill);
    const destSkillDir = path.join(skillsDest, skill);
    if (!fs.existsSync(srcSkillDir)) continue;
    if (!dryRun) copyDirRecursive(srcSkillDir, destSkillDir);
    console.log('  ' + skill + '/');
    skillCount++;
  }

  console.log('\nDone!');
  console.log('  Plugin: ' + fileCount + ' files -> ' + toPosix(pluginDest));
  console.log('  Skills: ' + skillCount + ' bundled');
  console.log('');
  console.log('  Next steps:');
  console.log('  1. Restart Cline (or start a new session)');
  console.log('  2. Plugin provides full hooks: mode tracking, stats, safety checks');
  console.log('  3. Type /caveman to activate caveman mode');
  console.log('');
  console.log('  Phase 2 features enabled:');
  console.log('  - Mode switching persisted (~/.caveman/cline/)');
  console.log('  - Token stats via SDK hooks');
  console.log('  - Dangerous operation blocking');
  console.log('  - Output quality check');
}

function toPosix(p) { return p.replace(/\\/g, '/'); }

// ── Install ─────────────────────────────────────────────────────────────

function install(dryRun, projectMode, pluginMode) {
  const mode = projectMode ? 'project' : 'global';
  console.log('Installing caveman for Cline (' + mode + (pluginMode ? ', plugin' : '') + ')...\n');

  // Plugin mode: install SDK plugin
  if (pluginMode) {
    return installPlugin(dryRun, projectMode);
  }

  let rulesDest, skillsDest;
  if (projectMode) {
    rulesDest = path.join(process.cwd(), '.clinerules');
    skillsDest = path.join(process.cwd(), '.cline', 'skills');
  } else {
    rulesDest = getGlobalRulesDir();
    skillsDest = GLOBAL_SKILLS_DIR;
  }

  const ruleFile = path.join(rulesDest, 'caveman.md');
  const ruleSrc = path.join(RULES_SRC_DIR, 'caveman.md');

  if (!fs.existsSync(ruleSrc)) {
    console.error('Error: rule source not found: ' + ruleSrc);
    process.exit(1);
  }
  if (!fs.existsSync(SKILLS_SRC_DIR)) {
    console.error('Error: skills source not found: ' + SKILLS_SRC_DIR);
    process.exit(1);
  }

  // 1. Install rule
  console.log('-> Install rule to ' + toPosix(ruleFile));
  if (!dryRun) {
    fs.mkdirSync(rulesDest, { recursive: true });
    fs.copyFileSync(ruleSrc, ruleFile);
    console.log('  installed: caveman.md (alwaysApply: true)');
  } else {
    console.log('  would copy: ' + ruleSrc + ' -> ' + ruleFile);
  }

  // 2. Install skills
  console.log('\n-> Install skills to ' + toPosix(skillsDest));
  let skillCount = 0;
  for (const skill of SKILLS) {
    const srcSkillDir = path.join(SKILLS_SRC_DIR, skill);
    const destSkillDir = path.join(skillsDest, skill);
    if (!fs.existsSync(srcSkillDir)) {
      console.warn('  Warning: source not found: ' + srcSkillDir);
      continue;
    }
    if (!dryRun) copyDirRecursive(srcSkillDir, destSkillDir);
    const fileCount = countFiles(srcSkillDir);
    console.log('  ' + skill + '/ (' + fileCount + ' files)');
    skillCount++;
  }

  // 3. Summary
  console.log('\nDone!');
  console.log('  Rules:  ' + toPosix(ruleFile));
  console.log('  Skills: ' + skillCount + ' skills -> ' + toPosix(skillsDest));
  console.log('');
  console.log('  Next steps:');
  console.log('  1. Restart Cline (or start a new session)');
  console.log('  2. Compressed output is active via Rules (alwaysApply)');
  console.log('  3. Type /caveman to see available skills');
  console.log('  4. Type /caveman-help for the full reference card');
  console.log('');
  if (projectMode) {
    console.log('  Project install: rules and skills apply to current project only');
    console.log('  For global install, run: node scripts/install-cline.js');
  } else {
    console.log('  Global install: rules and skills apply to all projects');
    console.log('  For project install, run in project root: node scripts/install-cline.js --project');
  }
  console.log('');
  console.log('  Phase 1 limitations (no hooks):');
  console.log('  - Mode switching (lite/full/ultra/wenyan) relies on model understanding, no persisted state');
  console.log('  - /caveman-stats cannot compute real token stats (needs Phase 2 Plugin)');
  console.log('  - Dangerous operation blocking and output quality checks unavailable (needs Phase 2 Plugin)');
}

// ── Uninstall ───────────────────────────────────────────────────────────

function uninstallPlugin(dryRun, projectMode) {
  let pluginDest;
  if (projectMode) {
    pluginDest = path.join(process.cwd(), '.cline', 'plugins', 'caveman-cline');
  } else {
    pluginDest = GLOBAL_PLUGINS_DIR;
  }

  console.log('-> Remove plugin: ' + toPosix(pluginDest));
  if (fs.existsSync(pluginDest)) {
    if (!dryRun) {
      deleteDirRecursive(pluginDest);
      console.log('  removed');
    }
  } else {
    console.log('  not found, skipping');
  }

  // Clean up empty parent directories
  if (!dryRun) {
    try {
      const parent = path.dirname(pluginDest);
      if (fs.existsSync(parent)) {
        const remaining = fs.readdirSync(parent);
        if (remaining.length === 0) fs.rmdirSync(parent);
      }
    } catch { /* skip */ }
  }

  console.log('\nDone! Restart Cline for changes to take effect.');
}

function uninstall(dryRun, projectMode, pluginMode) {
  const mode = projectMode ? 'project' : 'global';
  console.log('Uninstalling caveman from Cline (' + mode + (pluginMode ? ', plugin' : '') + ')...\n');

  if (pluginMode) {
    return uninstallPlugin(dryRun, projectMode);
  }

  let rulesDest, skillsDest;
  if (projectMode) {
    rulesDest = path.join(process.cwd(), '.clinerules');
    skillsDest = path.join(process.cwd(), '.cline', 'skills');
  } else {
    rulesDest = getGlobalRulesDir();
    skillsDest = GLOBAL_SKILLS_DIR;
  }

  // 1. Remove rule
  const ruleFile = path.join(rulesDest, 'caveman.md');
  if (fs.existsSync(ruleFile)) {
    console.log('-> Remove rule: ' + toPosix(ruleFile));
    if (!dryRun) {
      fs.unlinkSync(ruleFile);
      console.log('  removed');
    }
  } else {
    console.log('-> Rule file not found, skipping');
  }

  // 2. Remove skills
  console.log('\n-> Remove skills (' + toPosix(skillsDest) + ')');
  for (const skill of SKILLS) {
    const dir = path.join(skillsDest, skill);
    if (fs.existsSync(dir)) {
      if (!dryRun) {
        deleteDirRecursive(dir);
        console.log('  removed: ' + skill + '/');
      } else {
        console.log('  would remove: ' + toPosix(dir));
      }
    }
  }

  // 3. Clean up empty directories
  if (!dryRun) {
    if (fs.existsSync(skillsDest)) {
      try {
        const remaining = fs.readdirSync(skillsDest);
        if (remaining.length === 0) {
          fs.rmdirSync(skillsDest);
          console.log('\n  Removed empty: ' + toPosix(skillsDest));
          const clineDir = path.dirname(skillsDest);
          if (fs.existsSync(clineDir)) {
            const clineRemaining = fs.readdirSync(clineDir);
            if (clineRemaining.length === 0) fs.rmdirSync(clineDir);
          }
        }
      } catch (e) { /* skip */ }
    }
    if (projectMode && fs.existsSync(rulesDest)) {
      try {
        const remaining = fs.readdirSync(rulesDest);
        if (remaining.length === 0) fs.rmdirSync(rulesDest);
      } catch (e) { /* skip */ }
    }
  }

  console.log('\nDone! Restart Cline for changes to take effect.');
}

// ── Entry point ─────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const doUninstall = args.includes('--uninstall');
  const projectMode = args.includes('--project');
  const pluginMode = args.includes('--plugin');

  if (doUninstall) {
    uninstall(dryRun, projectMode, pluginMode);
  } else {
    install(dryRun, projectMode, pluginMode);
  }
}

main();
